const assert = require('node:assert/strict');
const { test } = require('node:test');
const { nightlyDate, parseRemoteTags, planRelease, outputLines } = require('./release-plan.cjs');

const REPO = 'maddec01/mux-factory';
const HEAD = 'a'.repeat(40);

function ciRun(overrides = {}) {
    return {
        conclusion: 'success',
        event: 'push',
        head_branch: 'main',
        head_sha: HEAD,
        head_repository: { full_name: REPO },
        ...overrides,
    };
}

// A git where every commit is on main at app version 0.1.0, unless told otherwise.
function git({ versions = {}, offMain = [] } = {}) {
    return {
        isOnMain: (sha) => !offMain.includes(sha),
        versionAt: (sha) => versions[sha] ?? '0.1.0',
    };
}

function nightly(overrides = {}, tags = [], gitState) {
    return planRelease({
        eventName: 'workflow_run',
        workflowRun: ciRun(overrides),
        repository: REPO,
        runNumber: 57,
        date: '20261023',
        tags,
        ...git(gitState),
    });
}

function stable(tags, gitState) {
    return planRelease({ eventName: 'workflow_dispatch', repository: REPO, runNumber: 60, date: '20261024', tags, ...git(gitState) });
}

test('publishes a Nightly of the CI run head commit', () => {
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

test('skips a CI run that is not a green push to main of this repository', () => {
    const cases = [
        [{ conclusion: 'failure' }, /conclusion is failure/],
        [{ event: 'pull_request' }, /event is pull_request/],
        [{ head_branch: 'feat/x' }, /branch is feat\/x/],
        [{ head_repository: { full_name: 'someone/mux-factory' } }, /head repository is someone\/mux-factory/],
    ];
    for (const [overrides, reason] of cases) {
        const plan = nightly(overrides);
        assert.equal(plan.publish, false);
        assert.match(plan.reason, reason);
    }
});

test('skips a commit that already has a Nightly', () => {
    const plan = nightly({}, [{ name: 'v0.1.0-nightly.20261023.56', sha: HEAD }]);
    assert.equal(plan.publish, false);
    assert.match(plan.reason, /already has Nightly v0\.1\.0-nightly\.20261023\.56/);
});

test('publishes a Nightly when only a Stable Release tag points at the commit', () => {
    assert.equal(nightly({}, [{ name: 'v0.0.9', sha: HEAD }]).publish, true);
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
    assert.throws(() => stable(tags), /v0\.1\.0 already exists.*bump "version" in the app package's package\.json and wait for its Nightly/);
});

test('a Stable Release fails without a Nightly', () => {
    assert.throws(() => stable([]), /no Nightly/);
});

test('a Nightly takes the version of the commit it builds', () => {
    assert.equal(nightly({}, [], { versions: { [HEAD]: '0.2.0' } }).version, '0.2.0-nightly.20261023.57');
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
    assert.throws(() => nightly({}, [], { offMain: [HEAD] }), /is not on main/);
});

test('a skipped CI run reads nothing from git', () => {
    const plan = planRelease({
        eventName: 'workflow_run',
        workflowRun: ciRun({ event: 'pull_request' }),
        repository: REPO,
        tags: [],
        isOnMain: () => assert.fail('checked main'),
        versionAt: () => assert.fail('read the version'),
    });
    assert.equal(plan.publish, false);
});

test('rejects a version that is not x.y.z', () => {
    assert.throws(() => nightly({}, [], { versions: { [HEAD]: '0.1.0-beta' } }), /0\.1\.0-beta/);
});

test('rejects other events', () => {
    assert.throws(() => planRelease({ eventName: 'push', tags: [] }), /push/);
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
    assert.equal(outputLines({ publish: false, reason: 'CI run event is pull_request' }), 'publish=false\nreason=CI run event is pull_request\n');
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
