import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';

import { validateDraft } from './add-item.ts';
import { boardSections } from './board-view.ts';
import {
    blockedText,
    buildBranch,
    buildMessage,
    approvedMoveRefusal,
    approvedUnbuilt,
    canAbandon,
    canResumeShaping,
    itemTotal,
    kindLabel,
    labelKind,
    openBlockers,
    repoName,
    sameRepo,
    workMessage,
    earlierWorkMessage,
    earlierBuildMessage,
} from './model.ts';
import type { BoardData, Blocker, DependencyHold, DependencyObservationKind, Item, Status } from './model.ts';

function item(status: Status, labels: string[] = [], extra: Partial<Item> = {}): Item {
    return {
        id: 'x',
        revision: 0,
        status,
        statuses: status === 'Done' ? [] : [status],
        kind: labelKind(labels),
        content: 'ticket',
        number: 7,
        title: 't',
        url: 'https://github.com/acme/api/issues/7',
        repo: 'acme/api',
        labels,
        state: 'open',
        closedAs: null,
        parent: null,
        parentId: null,
        flow: 'single',
        subIssues: { total: 0, completed: 0 },
        blockers: [],
        updatedAt: '2026-10-21T09:00:00Z',
        closedAt: null,
        linkedPrs: [],
        slices: [],
        ...extra,
    };
}

test('only the latest stopped shaping session can resume, with fresh evidence that its whole family is inactive', () => {
    const stopped = {
        id: 'old',
        title: 'Shape',
        state: 'stopped' as const,
        updated: '2026-10-31T00:00:00Z',
        purpose: 'shape',
    };

    assert.equal(canResumeShaping(item('Shaping', [], { threads: [stopped] })), true);
    for (const state of ['running', 'needs you'] as const) {
        assert.equal(
            canResumeShaping(item('Shaping', [], { threads: [{ ...stopped, id: 'new', state }, stopped] })),
            false,
        );
    }
    assert.equal(canResumeShaping(item('Shaping', [], { threads: [{ ...stopped, state: 'done' }] })), true);
    assert.equal(
        canResumeShaping(item('Shaping', [], { threads: [{ ...stopped, state: 'done', queued: true }] })),
        false,
    );
    assert.equal(canResumeShaping(item('Ready', [], { threads: [stopped] })), false);
    assert.equal(
        canResumeShaping(item('Shaping', [], { threads: [{ ...stopped, observedAt: stopped.updated }] })),
        false,
    );
    assert.equal(canResumeShaping(item('Shaping', [], { threads: [{ ...stopped, hasLiveChildren: true }] })), false);
    assert.equal(canResumeShaping(item('Shaping', [], { threads: 'unavailable' })), false);
});

test("a ticket's labels give its kind", () => {
    assert.equal(labelKind(['bug', 'concept']), 'concept');
    assert.equal(labelKind([]), 'issue');
    assert.equal(labelKind(['improvement', 'build']), 'improvement', 'build only switches on slices');
    assert.equal(labelKind(['build', 'bug']), 'bug');
    assert.equal(labelKind(['build', 'feature']), 'feature');
    assert.equal(labelKind(['build']), 'build', 'with no other kind it reads as a build');
    assert.equal(labelKind(['build', 'decision-research']), 'decision');
    assert.equal(labelKind([['decision:', 'grill'].join(' ')]), 'issue', 'the old decision label is no kind');
    assert.equal(kindLabel(item('List', ['decision-task'])), 'decision-task');
    assert.equal(
        kindLabel(item('List', [], { kind: 'decision' })),
        'decision',
        'a recorded decision with no ticket label is a decision',
    );
});

/** A Dependency on the server team's blocker, met when `met` is, its ticket last read as `kind`. */
function dependency(kind: DependencyObservationKind, met = false, change: Partial<DependencyHold> = {}): Blocker {
    const hold: DependencyHold = {
        dependencyId: 'd1',
        revision: 2,
        owner: 'server team',
        need: 'An export endpoint',
        ticket: 'acme/api#40',
        named: [],
        evidence: 'The endpoint answers in staging',
        met: met ? { by: 'user', at: '2026-10-30T10:00:00Z' } : null,
        needsReview: false,
        observation: {
            subject: 'acme/api#40',
            kind,
            detail: null,
            observedAt: '2026-10-30T09:00:00Z',
            lastGood: null,
        },
        ...change,
    };

    return {
        number: 40,
        repo: 'acme/api',
        state: met ? 'closed' : 'open',
        title: hold.need,
        dependency: hold,
    };
}

test("an unmet Dependency holds the start whatever its ticket shows, and a met one doesn't", () => {
    const unmet = dependency('closed');

    assert.deepEqual(openBlockers(item('Ready', [], { blockers: [unmet, dependency('open', true)] })), [unmet]);
    assert.equal(
        blockedText(item('Ready', [], { blockers: [unmet] })),
        'Blocked by the Dependency on server team until you mark it met',
    );
    assert.equal(
        blockedText(item('Ready', [], { blockers: [{ number: 3, repo: 'acme/api', state: 'open' }, unmet] })),
        'Blocked by #3 until it completes, and by the Dependency on server team until you mark it met',
    );
    assert.equal(blockedText(item('Ready', [], { blockers: [dependency('open', true)] })), null);
});

const context = { dataDir: '/d', bin: '/b', shapeSkill: '/s/SKILL.md', buildSkill: '/l/SKILL.md' };

test('the work message names the thread for shaping, then reads the supplied lar-shape entry for the work ID', () => {
    const work = item('Queued', [], {
        id: '0b6e2c1a-5d4f-4e3b-9a7c-1f2e3d4c5b6a',
        number: 760,
        title: 'Improve T3 Code thread names',
    });
    const [title, instructions] = workMessage(work, context).split('\n');

    assert.equal(title, 'Shaping #760 Improve T3 Code thread names');
    assert.equal(instructions, "Shape 0b6e2c1a-5d4f-4e3b-9a7c-1f2e3d4c5b6a. Read '/s/SKILL.md' and follow it.");
    assert.ok(!workMessage(work, context).includes('$lar-shape'));
});

test('the messages before the phase names are kept for a launch still unresolved', () => {
    const work = item('Ready', [], { id: 'w1', number: 7, title: 'T' });

    assert.equal(earlierWorkMessage(work, context), workMessage(work, context).replace('Shaping ', ''));
    assert.equal(earlierBuildMessage(work, context), buildMessage(work, context).split('\n').slice(1).join('\n'));
});

test('a build branch is <kind>/<n>-<slug>: fix for a bug, feat for a feature or improvement, else chore', () => {
    const title = 'Add Start build to the board server';

    assert.equal(buildBranch(item('Ready', ['bug'], { title })), 'fix/7-add-start-build-to-the');
    assert.equal(buildBranch(item('Ready', ['feature'], { title })), 'feat/7-add-start-build-to-the');
    assert.equal(buildBranch(item('Ready', ['improvement', 'build'], { title })), 'feat/7-add-start-build-to-the');
    assert.equal(buildBranch(item('Ready', ['build'], { title })), 'chore/7-add-start-build-to-the');
    assert.equal(buildBranch(item('Ready', [], { title })), 'chore/7-add-start-build-to-the');
});

test('the build message names the thread for the build, then the work ID and the builder agent of the supplied lar-build', () => {
    assert.deepEqual(
        buildMessage(item('Ready', [], { id: 'w1', number: 760, title: 'Improve T3 Code thread names' }), {
            ...context,
            buildSkill: '/data/bundles/2.0.0/skills/lar-build/SKILL.md',
        })
            .split('\n')
            .slice(0, 2),
        [
            'Build #760 Improve T3 Code thread names',
            'Build w1. Read /data/bundles/2.0.0/skills/lar-build/agents/builder.md and follow it.',
        ],
    );
});

test('an item total adds each sub-issue on the board once, at any depth, and is null when sub-issues add nothing', () => {
    const repo = 'acme/api';
    const under = (n: number) => ({
        number: n,
        title: 't',
        url: `https://github.com/${repo}/issues/${n}`,
        repo: 'Acme/Api',
        state: 'open' as const,
    });
    const parent = item('In progress', [], {
        id: 'p',
        number: 7,
        stats: { agentMs: 10, wallMs: 1, tokens: 100, costUsd: 0.5 },
    });
    const build = item('Done', ['build'], {
        id: 'b',
        number: 8,
        parent: under(7),
        parentId: 'p',
        stats: { agentMs: 20, wallMs: 2, tokens: 200, costUsd: 3, frozen: true },
    });
    const nested = item('Done', ['build'], {
        id: 'n',
        number: 9,
        parent: under(8),
        parentId: 'b',
        stats: { agentMs: 40, tokens: 400, costUsd: 5, frozen: true },
    });
    const quiet = item('Ready', [], { id: 'q', number: 10, parent: under(7), parentId: 'p' });
    const other = item('Done', [], {
        id: 'o',
        number: 11,
        repo: 'acme/ios',
        parent: under(7),
        parentId: 'p',
        stats: { agentMs: 1, tokens: 1 },
    });
    const items = [parent, build, nested, quiet, other];

    assert.deepEqual(
        itemTotal(parent, items),
        { agentMs: 71, tokens: 701, costUsd: 8.5 },
        'wall only when every figure has it, frozen only when all are',
    );
    assert.deepEqual(itemTotal(build, items), { agentMs: 60, tokens: 600, costUsd: 8, frozen: true });
    assert.equal(itemTotal(nested, items), null, 'no sub-issues: the total equals the item stats');
    assert.equal(itemTotal(quiet, items), null);
    assert.equal(itemTotal(parent, [parent, quiet]), null, 'sub-issues without figures add nothing');
    assert.equal(
        itemTotal(parent, [
            parent,
            { ...quiet, stats: { agentMs: 0, wallMs: 0, tokens: 0, costUsd: 0 } },
            { ...other, stats: { agentMs: 0, tokens: 0 } },
        ]),
        null,
        'sub-issues with all-zero figures leave the total equal to the item stats',
    );
    assert.deepEqual(
        itemTotal(item('Queued', [], { id: 'p', number: 7 }), [build]),
        { agentMs: 20, wallMs: 2, tokens: 200, costUsd: 3, frozen: true },
        'a parent without its own figures totals its sub-issues',
    );

    const looped = { ...parent, parent: under(8), parentId: 'b' };

    assert.deepEqual(
        itemTotal(looped, [looped, build, build]),
        { agentMs: 30, wallMs: 3, tokens: 300, costUsd: 3.5 },
        'each item counts once, even listed twice or in a loop',
    );
    assert.equal(
        itemTotal(parent, [parent, { ...build, stats: 'unavailable' }]),
        'unavailable',
        'an unreadable figure leaves the total unknown',
    );
    assert.equal(itemTotal({ ...parent, stats: 'unavailable' }, [build]), 'unavailable');
});

const sample = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;

test('canAbandon takes List and Queued issues, never other statuses', () => {
    for (const status of ['List', 'Queued'] as const) {
        assert.ok(canAbandon(item(status)), `${status} issue`);
    }
    for (const status of ['Shaping', 'In progress', 'Done'] as const) assert.ok(!canAbandon(item(status)), status);
});

test('approved Ready work moves until a thread works on it or its Spec publishes, but never once it starts building', () => {
    const done = { id: 'shape', title: 'Shaping', state: 'done' as const, updated: '2026-11-18T00:00:00Z' };
    const ready = item('Ready', [], { approved: true, threads: [done] });

    assert.ok(canAbandon(ready) && approvedUnbuilt(ready), 'a finished shaping thread alone holds nothing');
    assert.equal(approvedMoveRefusal(ready), null);
    assert.ok(approvedMoveRefusal({ ...ready, threads: [{ ...done, state: 'running' }] }));
    assert.ok(approvedMoveRefusal({ ...ready, specSync: { pending: true, error: null, warning: null } }));
    assert.ok(!canAbandon({ ...ready, buildStarted: true }), 'a started build keeps its actions');
    assert.ok(!canAbandon(item('Ready')), 'unapproved Ready work stays as it was');
});

test("a repository's owner/name matches whatever its case, as GitHub's does, so a hand-written spelling still finds its items", () => {
    assert.equal(sameRepo('Maddec01/Lar-Factory', 'maddec01/lar-factory'), true);
    assert.equal(sameRepo('maddec01/lar-factory', 'acme/api'), false);

    const repos = [
        { repo: 'Acme/core', role: 'app', labels: [] },
        { repo: 'fabrikam/core', role: 'app', labels: [] },
    ];

    assert.equal(repoName('acme/core', repos), 'acme/core', 'the same repository in another case is not a second one');
    assert.equal(repoName('acme/core', [{ repo: 'Acme/core', role: 'app', labels: [] }]), 'core');

    const items = [
        item('List', [], { id: 'a', repo: 'acme/core' }),
        item('List', [], { id: 'b', repo: 'fabrikam/core' }),
    ];
    const groups = boardSections({ ...sample, repos, items }, Date.parse('2026-10-21T10:00:00Z')).listGroups;

    assert.deepEqual(
        groups.map((g) => [g.repo, g.items.map((i) => i.id)]),
        [
            ['Acme/core', ['a']],
            ['fabrikam/core', ['b']],
        ],
    );
});

test('Add item keeps the title trimmed and the description as written, and nothing else the page sends', () => {
    const draft = {
        repo: 'acme/api',
        kind: 'feature',
        title: ' Index files ',
        description: '## Why\nSearch.',
        labels: ['bug'],
    };

    assert.deepEqual(validateDraft(draft, sample.repos), {
        repo: 'acme/api',
        kind: 'feature',
        title: 'Index files',
        description: '## Why\nSearch.',
    });
});

test('Add item refuses an unlisted repository, an unknown kind and a blank title', () => {
    const draft = { repo: 'acme/api', kind: 'feature', title: 'Index files', description: '' };

    for (const input of [
        null,
        { ...draft, repo: 'other/repo' },
        { ...draft, kind: 'concept' },
        { ...draft, title: ' \n ' },
        { ...draft, title: 12 },
        { ...draft, description: {} },
    ]) {
        assert.throws(() => validateDraft(input, sample.repos), /./, JSON.stringify(input));
    }
});

test('a thread message carries one runtime block with the isolated factory environment and absolute skill entries', () => {
    const context = {
        dataDir: "/tmp/O'Brien $(literal)/data",
        bin: '/tmp/factory home/.local/bin',
        shapeSkill: '/tmp/factory home/data/bundles/2.0.0/skills/lar-shape/SKILL.md',
        buildSkill: '/tmp/factory home/data/bundles/2.0.0/skills/lar-build/SKILL.md',
        azureReadOnly: true,
        delegationModel: { instanceId: 'codex', model: 'delegate', options: [] },
    };
    const work = item('Queued', [], { id: 'w-safe' });
    const message = workMessage(work, context);

    assert.ok(message.includes("Read '/tmp/factory home/data/bundles/2.0.0/skills/lar-shape/SKILL.md'"));
    assert.ok(message.includes("export LAR_FACTORY_DATA_DIR='/tmp/O'\\''Brien $(literal)/data'"));
    assert.ok(message.includes(`export PATH='/tmp/factory home/.local/bin':"$PATH"`));
    assert.ok(message.includes("Use '/tmp/factory home/.local/bin/lar-work' for work records."));
    assert.ok(
        message.includes(
            `Factory skill entries: ${JSON.stringify({ 'lar-shape': context.shapeSkill, 'lar-build': context.buildSkill })}`,
        ),
    );
    assert.ok(message.includes("export LAR_FACTORY_AZURE_READ_ONLY='1'"));
    assert.equal(message.match(/<!-- factory-runtime:start -->/g)?.length, 1);
    assert.doesNotMatch(message, /LAR_FACTORY_(?:BIN|SHAPE_SKILL|BUILD_SKILL)|verbatim|Default every delegated role/);
    assert.ok(message.includes('Do not build'));
    assert.equal(workMessage(work, context), message, 'recovery uses a stable first message');

    const build = buildMessage(work, context);

    assert.ok(build.includes("export LAR_FACTORY_DATA_DIR='/tmp/O'\\''Brien $(literal)/data'"));

    // A run saved before launches were recorded keeps the earlier block, which told threads to pass it on verbatim.
    const earlier = workMessage(work, { ...context, earlier: true });

    assert.ok(earlier.includes("export LAR_FACTORY_BIN='/tmp/factory home/.local/bin'"));
    assert.ok(earlier.includes('every child task prompt'));
    assert.ok(earlier.includes('Default every delegated role'));
});
