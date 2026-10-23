const assert = require('node:assert/strict');
const { test } = require('node:test');
const { nightlyDate, parseRemoteTags, planRelease, outputLines } = require('./release-plan.cjs');

const HEAD = 'a'.repeat(40);

// The latest CI run for HEAD on a push to main, as the Release workflow fetches it.
function ciRun(overrides = {}) {
    return { status: 'completed', conclusion: 'success', ...overrides };
}

// A git where every commit is on main at app version 0.1.0, unless told otherwise.
function git({ versions = {}, offMain = [] } = {}) {
    return {
        isOnMain: (sha) => !offMain.includes(sha),
        versionAt: (sha) => versions[sha] ?? '0.1.0',
    };
}

function nightly(run = ciRun(), tags = [], gitState) {
    return planRelease({
        channel: 'nightly',
        headSha: HEAD,
        ciRun: run,
        runNumber: 57,
        date: '20261023',
        tags,
        ...git(gitState),
    });
}

function stable(tags, gitState) {
    return planRelease({ channel: 'stable', runNumber: 60, date: '20261024', tags, ...git(gitState) });
}

test('publishes a Nightly of main\'s head', () => {
    assert.deepEqual(nightly(), {
        publish: true,
        channel: 'nightly',
        version: '0.1.0-nightly.20261023.57',
        tag: 'v0.1.0-nightly.20261023.57',
        sha: HEAD,
        prerelease: true,
        makeLatest: false,
        feed: 'nightly-mac.yml',
    });
});

test('dates a Nightly by its UTC day', () => {
    assert.equal(nightlyDate(new Date('2026-10-23T23:59:59Z')), '20261023');
    assert.equal(nightlyDate(new Date('2026-01-02T00:00:00Z')), '20260102');
});

test('a Nightly fails when CI failed on the head', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
        assert.throws(() => nightly(ciRun({ conclusion })), /^Error: CI failed on aaaaaaaaaaaa; fix main before a Nightly\.$/);
    }
});

test('a Nightly fails when CI has not finished on the head', () => {
    for (const run of [null, ciRun({ status: 'in_progress', conclusion: null }), ciRun({ status: 'queued', conclusion: null })]) {
        assert.throws(() => nightly(run), /^Error: CI has not finished on aaaaaaaaaaaa; try again when it has\.$/);
    }
});

test('skips a head that already has a Nightly', () => {
    const plan = nightly(ciRun(), [{ name: 'v0.1.0-nightly.20261023.56', sha: HEAD }]);
    assert.equal(plan.publish, false);
    assert.match(plan.reason, /already has Nightly v0\.1\.0-nightly\.20261023\.56/);
});

test('publishes a Nightly when only a Stable Release tag points at the commit', () => {
    assert.equal(nightly(ciRun(), [{ name: 'v0.0.9', sha: HEAD }]).publish, true);
});

test('a Stable Release rebuilds the latest Nightly commit', () => {
    const plan = stable([
        { name: 'v0.0.9', sha: 'f'.repeat(40) },
        { name: 'v0.1.0-nightly.20261023.9', sha: 'b'.repeat(40) },
        { name: 'v0.1.0-nightly.20261023.10', sha: 'c'.repeat(40) },
        { name: 'v0.1.0-nightly.20261022.58', sha: 'd'.repeat(40) },
    ]);
    assert.deepEqual(plan, {
        publish: true,
        channel: 'stable',
        version: '0.1.0',
        tag: 'v0.1.0',
        sha: 'c'.repeat(40),
        prerelease: false,
        makeLatest: true,
        feed: 'latest-mac.yml',
    });
});

test('a Stable Release fails when its tag exists', () => {
    const tags = [{ name: 'v0.1.0-nightly.20261023.57', sha: HEAD }, { name: 'v0.1.0', sha: HEAD }];
    assert.throws(() => stable(tags), /v0\.1\.0 already exists.*bump "version" in the app package's package\.json, merge it and start its Nightly/);
});

test('a Stable Release fails without a Nightly', () => {
    assert.throws(() => stable([]), /no Nightly/);
});

test('a Nightly takes the version of the commit it builds', () => {
    assert.equal(nightly(ciRun(), [], { versions: { [HEAD]: '0.2.0' } }).version, '0.2.0-nightly.20261023.57');
});

test('a Stable Release takes the version of the Nightly commit it rebuilds', () => {
    const sha = 'b'.repeat(40);
    const plan = stable([{ name: 'v0.1.0-nightly.20261023.9', sha }], { versions: { [sha]: '0.2.0' } });
    assert.equal(plan.version, '0.2.0');
    assert.equal(plan.tag, 'v0.2.0');
});

test('a Stable Release fails when the latest Nightly commit is not on main', () => {
    const sha = 'b'.repeat(40);
    assert.throws(() => stable([{ name: 'v0.1.0-nightly.20261023.9', sha }], { offMain: [sha] }), /bbbbbbbbbbbb is not on main/);
});

test('a Nightly fails when its commit is not on main', () => {
    assert.throws(() => nightly(ciRun(), [], { offMain: [HEAD] }), /is not on main/);
});

test('a head with a Nightly reads nothing from git', () => {
    const plan = planRelease({
        channel: 'nightly',
        headSha: HEAD,
        ciRun: ciRun(),
        tags: [{ name: 'v0.1.0-nightly.20261023.56', sha: HEAD }],
        isOnMain: () => assert.fail('checked main'),
        versionAt: () => assert.fail('read the version'),
    });
    assert.equal(plan.publish, false);
});

test('rejects a version that is not x.y.z', () => {
    assert.throws(() => nightly(ciRun(), [], { versions: { [HEAD]: '0.1.0-beta' } }), /0\.1\.0-beta/);
});

test('rejects other channels', () => {
    assert.throws(() => planRelease({ channel: 'preview', tags: [] }), /preview/);
});

test('reads tags and their commits from git ls-remote, peeling annotated tags', () => {
    const text = [
        `${'1'.repeat(40)}\trefs/tags/v0.1.0-nightly.20261023.57`,
        `${'2'.repeat(40)}\trefs/tags/v0.1.0`,
        `${'3'.repeat(40)}\trefs/tags/v0.1.0^{}`,
        '',
    ].join('\n');
    assert.deepEqual(parseRemoteTags(text), [
        { name: 'v0.1.0-nightly.20261023.57', sha: '1'.repeat(40) },
        { name: 'v0.1.0', sha: '3'.repeat(40) },
    ]);
});

test('writes the plan as GITHUB_OUTPUT lines', () => {
    assert.equal(outputLines({ publish: false, reason: 'nothing to do' }), 'publish=false\nreason=nothing to do\n');
    assert.equal(
        outputLines(nightly()),
        [
            'publish=true',
            'channel=nightly',
            'version=0.1.0-nightly.20261023.57',
            'tag=v0.1.0-nightly.20261023.57',
            `sha=${HEAD}`,
            'prerelease=true',
            'make_latest=false',
            'feed=nightly-mac.yml',
            '',
        ].join('\n'),
    );
});
