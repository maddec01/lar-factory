// Plans a board app Release on the channel Pedro picked when he started the Release workflow.
// The Nightly version scheme and the Stable Release's choice of the latest Nightly's
// commit are adapted from T3 Code's scripts/resolve-nightly-release.ts and
// .github/scripts/check-nightly-release.cjs (https://github.com/pingdotgg/t3code).
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

const NIGHTLY_TAG = /^v(?<version>\d+\.\d+\.\d+)-nightly\.(?<date>\d{8})\.(?<run>\d+)$/;

function nightlyDate(now) {
    return now.toISOString().slice(0, 10).replaceAll('-', '');
}

// `git ls-remote --tags` lists an annotated tag twice; the `^{}` line holds the commit.
function parseRemoteTags(text) {
    const tags = new Map();
    for (const line of text.split('\n')) {
        const match = /^(?<sha>[0-9a-f]{40})\trefs\/tags\/(?<name>.+?)(?<peeled>\^\{\})?$/.exec(line);
        if (!match) continue;
        const { sha, name, peeled } = match.groups;
        if (peeled || !tags.has(name)) tags.set(name, sha);
    }
    return [...tags].map(([name, sha]) => ({ name, sha }));
}

function latestNightly(tags) {
    const key = (tag) => {
        const { date, run } = NIGHTLY_TAG.exec(tag.name).groups;
        return [Number(date), Number(run)];
    };
    return tags
        .filter((tag) => NIGHTLY_TAG.test(tag.name))
        .sort((a, b) => {
            const [aDate, aRun] = key(a);
            const [bDate, bRun] = key(b);
            return bDate - aDate || bRun - aRun;
        })[0];
}

// The Release builds the commit's own version, read without running its code.
function releaseVersion(sha, { isOnMain, versionAt }) {
    if (!isOnMain(sha)) throw new Error(`Commit ${sha.slice(0, 12)} is not on main; a Release builds only commits on main.`);
    const version = versionAt(sha);
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`The app package version "${version}" at ${sha.slice(0, 12)} must be x.y.z.`);
    }
    return version;
}

// ciRun is CI's latest run for headSha on a push to main, or null when there is none.
function planNightly({ headSha: sha, ciRun, runNumber, date, tags, isOnMain, versionAt }) {
    const short = sha.slice(0, 12);
    const existing = tags.find((tag) => tag.sha === sha && NIGHTLY_TAG.test(tag.name));
    if (existing) return { publish: false, reason: `commit ${short} already has Nightly ${existing.name}; nothing to publish` };
    if (ciRun?.status !== 'completed') throw new Error(`CI has not finished on ${short}; try again when it has.`);
    if (ciRun.conclusion !== 'success') throw new Error(`CI failed on ${short}; fix main before a Nightly.`);
    const version = releaseVersion(sha, { isOnMain, versionAt });
    const nightlyVersion = `${version}-nightly.${date}.${runNumber}`;
    return {
        publish: true,
        channel: 'nightly',
        version: nightlyVersion,
        tag: `v${nightlyVersion}`,
        sha,
        prerelease: true,
        makeLatest: false,
        feed: 'nightly-mac.yml',
    };
}

function planStable({ tags, isOnMain, versionAt }) {
    const nightly = latestNightly(tags);
    if (!nightly) throw new Error('There is no Nightly yet; a Stable Release rebuilds the latest Nightly commit.');
    const version = releaseVersion(nightly.sha, { isOnMain, versionAt });
    const tag = `v${version}`;
    if (tags.some((t) => t.name === tag)) {
        throw new Error(
            `${tag} already exists; bump "version" in the app package's package.json, merge it and start its Nightly before a new Stable Release.`,
        );
    }
    return {
        publish: true,
        channel: 'stable',
        version,
        tag,
        sha: nightly.sha,
        prerelease: false,
        makeLatest: true,
        feed: 'latest-mac.yml',
    };
}

// tags: [{ name, sha }] with sha the commit each tag points at.
// isOnMain(sha) tells whether main contains the commit; versionAt(sha) reads the
// app package version at it.
function planRelease(input) {
    if (input.channel === 'nightly') return planNightly(input);
    if (input.channel === 'stable') return planStable(input);
    throw new Error(`There is no ${input.channel} channel; pick nightly or stable.`);
}

function outputLines(plan) {
    const entries = plan.publish
        ? [
            ['publish', true],
            ['channel', plan.channel],
            ['version', plan.version],
            ['tag', plan.tag],
            ['sha', plan.sha],
            ['prerelease', plan.prerelease],
            ['make_latest', plan.makeLatest],
            ['feed', plan.feed],
        ]
        : [['publish', false], ['reason', plan.reason]];
    return entries.map(([key, value]) => `${key}=${value}\n`).join('');
}

module.exports = { nightlyDate, parseRemoteTags, planRelease, outputLines };

// Usage: git ls-remote --tags origin | node release-plan.cjs <app package.json path>
// Run it in a clone with main's full history in origin/main. CHANNEL names the
// channel; a Nightly also takes HEAD_SHA, main's head, and CI_RUN, the JSON of
// CI's latest run for it on a push to main (null when there is none).
if (require.main === module) {
    const fs = require('node:fs');
    const { execFileSync } = require('node:child_process');
    const { env } = process;
    let plan;
    try {
        plan = planRelease({
            channel: env.CHANNEL,
            headSha: env.HEAD_SHA,
            ciRun: JSON.parse(env.CI_RUN || 'null'),
            runNumber: Number(env.GITHUB_RUN_NUMBER),
            date: nightlyDate(new Date()),
            // Exit 1 means not an ancestor, 128 an unknown commit: neither is on main.
            isOnMain: (sha) => {
                try {
                    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { stdio: 'ignore' });
                    return true;
                } catch {
                    return false;
                }
            },
            versionAt: (sha) => JSON.parse(execFileSync('git', ['show', `${sha}:${process.argv[2]}`], { encoding: 'utf8' })).version,
            tags: parseRemoteTags(fs.readFileSync(0, 'utf8')),
        });
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exit(1);
    }
    if (!plan.publish) console.log(`::notice::${plan.reason}`);
    const lines = outputLines(plan);
    process.stdout.write(lines);
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines);
}
