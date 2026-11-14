import { it, expect } from 'vite-plus/test';

import {
    buildActivity,
    buildsAtWork,
    canRetryBuild,
    delegatedWorkRunning,
    limitNumber,
    workingAgain,
    type Item,
    type StartProgress,
} from './model.ts';

it('requires current build execution and rejects waiting, cached and stale evidence', () => {
    const item = {
        status: 'In progress',
        buildPhase: 'implement',
        threads: [{ purpose: 'build', state: 'running', currentRunning: true }],
    } as unknown as Item;

    expect(buildActivity(item)).toEqual({ label: 'Implementing', running: true });
    expect(buildActivity(item, true).running).toBe(false);
    expect(buildActivity({ ...item, threads: 'unavailable' })).toEqual({
        label: 'Activity unavailable',
        running: false,
    });
    for (const thread of [
        { purpose: 'shape', currentRunning: true },
        { purpose: 'build', state: 'running' },
        { purpose: 'build', currentRunning: true, observedAt: 'cached' },
    ]) {
        expect(buildActivity({ ...item, threads: [thread] } as Item).running).toBe(false);
    }
    expect(buildActivity({ ...item, status: 'Done' })).toEqual({ label: 'Done', running: false });
    expect(buildActivity({ ...item, threads: [] }, false, { phase: 'starting' })).toEqual({
        label: 'Starting',
        running: false,
    });
});

it('shows a relaunch after stopped or finished build threads, also while activity is stale', () => {
    for (const state of ['stopped', 'finished']) {
        const relaunching = { status: 'In progress', threads: [{ purpose: 'build', state }] } as Item;

        expect(buildActivity(relaunching, true, { phase: 'starting' })).toEqual({ label: 'Starting', running: false });
        expect(buildActivity(relaunching, false, { phase: 'may-have-started', message: 'Check T3.' })).toEqual({
            label: 'May have started',
            running: false,
        });
    }
});

it('does not call finished slices Implementing while the builder moves to its next phase', () => {
    const item = {
        status: 'In progress',
        buildPhase: 'implement',
        slices: [{ progress: 'done' }],
        threads: [{ purpose: 'build', state: 'running', currentRunning: true }],
    } as unknown as Item;

    expect(buildActivity(item)).toEqual({ label: 'Finishing build', running: true });
    expect(buildActivity({ ...item, buildPhase: 'full-checks' })).toEqual({ label: 'Checks', running: true });
    expect(buildActivity({ ...item, slices: [...item.slices, { progress: 'active' }] } as Item).label).toBe(
        'Implementing',
    );
    expect(buildActivity({ ...item, slices: [] }).label).toBe('Implementing');
    expect(buildActivity(item, true)).toEqual({ label: 'Activity unavailable', running: false });
    expect(buildActivity({ ...item, threads: [{ purpose: 'build', state: 'done' }] } as Item).running).toBe(false);
});

it('active delegated work counts as working after the parent run ended', () => {
    const finished = {
        status: 'In progress',
        buildPhase: 'implement',
        slices: [{ progress: 'active' }],
        threads: [{ purpose: 'build', state: 'done' }],
    } as unknown as Item;

    expect(delegatedWorkRunning(finished)).toBe(true);
    expect(buildActivity(finished)).toEqual({ label: 'Implementing', running: true });
    expect(buildActivity(finished, true).running, 'stale activity stays unavailable').toBe(false);
    expect(workingAgain({ ...finished, status: 'Verify' })).toBe(true);

    const ended = { ...finished, slices: [{ progress: 'done' }] } as unknown as Item;

    expect(delegatedWorkRunning(ended)).toBe(false);
    expect(buildActivity(ended).running).toBe(false);

    const childOf = (thread: object) =>
        ({ ...ended, threads: [{ purpose: 'build', state: 'done', ...thread }] }) as unknown as Item;

    expect(delegatedWorkRunning(childOf({ hasRunningChildren: true }))).toBe(true);
    expect(
        delegatedWorkRunning(childOf({ hasRunningChildren: true, observedAt: 'cached' })),
        'a cached child proves nothing',
    ).toBe(false);
    expect(
        workingAgain({ ...childOf({ hasLiveChildren: true }), status: 'Verify' }),
        'a child waiting on you stays on the desk',
    ).toBe(false);

    const shaping = {
        ...ended,
        status: 'Ready',
        threads: [{ purpose: 'shape', state: 'done', hasRunningChildren: true, hasLiveChildren: true }],
    } as unknown as Item;

    expect(buildActivity(shaping).running, 'a shaping child is no build evidence').toBe(false);
    expect(workingAgain({ ...shaping, status: 'Ready to merge' })).toBe(false);
    expect(
        canRetryBuild({
            status: 'In progress',
            buildPhase: null,
            slices: [{ progress: 'active' }],
            threads: [{ purpose: 'build', state: 'stopped' }],
        } as unknown as Item),
    ).toBe(false);
});

it('a failed start leaves the row as it was', () => {
    const item = { status: 'Ready', threads: [] } as unknown as Item;

    expect(buildActivity(item, false, { phase: 'failed', message: 'No' })).toEqual(buildActivity(item));
});

it('offers a retry for a stopped build in its system-recorded plan before slices or implementation', () => {
    const stopped = {
        status: 'In progress',
        buildPhase: null,
        threads: [{ purpose: 'build', state: 'stopped' }],
    } as unknown as Item;

    expect(canRetryBuild(stopped)).toBe(true);
    expect(canRetryBuild({ ...stopped, buildPhase: 'plan' })).toBe(true);
    expect(canRetryBuild({ ...stopped, buildPhase: 'implement' })).toBe(false);
    expect(
        canRetryBuild({ ...stopped, buildPhase: 'plan', slices: [{ progress: 'waiting' }] } as unknown as Item),
    ).toBe(false);
    expect(canRetryBuild({ ...stopped, buildPhase: 'plan', linkedPrs: [{}] } as unknown as Item)).toBe(false);
    expect(canRetryBuild({ ...stopped, status: 'Review' })).toBe(false);
    expect(canRetryBuild({ ...stopped, threads: [{ purpose: 'build', state: 'running' }] } as unknown as Item)).toBe(
        false,
    );
    expect(
        canRetryBuild({
            ...stopped,
            threads: [{ purpose: 'build', state: 'stopped', hasLiveChildren: true }],
        } as unknown as Item),
    ).toBe(false);
    expect(canRetryBuild({ ...stopped, threads: [] })).toBe(false);
    expect(canRetryBuild({ ...stopped, threads: 'unavailable' })).toBe(false);
});

for (const status of ['Verify', 'Ready to merge'] as const) {
    const running = {
        status,
        buildPhase: 'retro',
        threads: [{ id: 'build', purpose: 'build', state: 'running', currentRunning: true }],
    } as unknown as Item;

    it(`says Working at ${status} while the build thread or a child runs, whatever the phase`, () => {
        expect(buildActivity(running)).toEqual({ label: 'Working', running: true });
        expect(
            buildActivity({
                ...running,
                threads: [{ purpose: 'build', state: 'done', hasRunningChildren: true }],
            } as Item),
        ).toEqual({ label: 'Working', running: true });
    });

    it(`says ${status} when the thread is idle, asks a question, is held or can't be read`, () => {
        const recorded = { label: status, running: false };

        expect(buildActivity({ ...running, threads: [{ purpose: 'build', state: 'done' }] } as Item)).toEqual(recorded);
        expect(buildActivity({ ...running, threads: [{ purpose: 'build', state: 'needs you' }] } as Item)).toEqual(
            recorded,
        );
        expect(
            buildActivity({
                ...running,
                threads: [{ purpose: 'build', state: 'needs you', hasRunningChildren: true }],
            } as Item),
        ).toEqual(recorded);
        expect(buildActivity({ ...running, needsYou: { reason: 'Stuck', offers: [] } } as unknown as Item)).toEqual(
            recorded,
        );
        expect(buildActivity(running, true)).toEqual(recorded);
    });
}

it('counts builds against the build limit while they start, build or work again, never a concept', () => {
    const item = (id: string, change: Partial<Item>) =>
        ({ id, kind: 'feature', status: 'Ready', threads: [], slices: [], ...change }) as unknown as Item;
    const again = {
        threads: [{ purpose: 'build', state: 'running', currentRunning: true }],
    } as unknown as Partial<Item>;
    const items = [
        item('ready', {}),
        item('starting', {}),
        item('may', {}),
        item('failed', {}),
        item('progress', { status: 'In progress', buildStarted: true }),
        item('review', { status: 'Review', buildStarted: true }),
        item('verify', { status: 'Verify' }),
        item('again', { status: 'Ready to merge', ...again }),
        item('concept', { kind: 'concept', status: 'In progress' }),
        item('shaping', { status: 'Shaping' }),
    ];
    const startProgress: Record<string, { build?: StartProgress; shape?: StartProgress }> = {
        starting: { build: { phase: 'starting' } },
        may: { build: { phase: 'may-have-started', message: 'Check T3.' } },
        failed: { build: { phase: 'failed', message: 'Refused.' } },
        shaping: { shape: { phase: 'starting' } },
    };

    expect(buildsAtWork({ items, startProgress }).map((i) => i.id)).toEqual([
        'starting',
        'may',
        'progress',
        'review',
        'again',
    ]);
    expect(
        buildsAtWork({ items, startProgress }, true).map((i) => i.id),
        'unknown activity retains a started build reservation',
    ).toEqual(['starting', 'may', 'progress', 'review', 'again']);
});

it('a limit allows its number, or what Automatic gives', () => {
    expect(limitNumber({ limit: 'automatic', automatic: 3 })).toBe(3);
    expect(limitNumber({ limit: 5, automatic: 3 })).toBe(5);
});

it('excludes a coordinating linked parent while counting real child builds and explicit parent build evidence', () => {
    const parent = {
        id: 'parent',
        kind: 'feature',
        flow: 'linked',
        status: 'In progress',
        subIssues: { total: 1, completed: 0 },
        threads: [],
        linkedPrs: [],
    } as unknown as Item;
    const child = {
        ...parent,
        id: 'child',
        kind: 'build',
        buildStarted: true,
        parentId: parent.id,
        subIssues: { total: 0, completed: 0 },
    } as Item;
    const counted = (change: Partial<Item> = {}, startProgress = {}) =>
        buildsAtWork({ items: [{ ...parent, ...change }, child], startProgress }).map((work) => work.id);

    expect(counted()).toEqual(['child']);
    expect(counted({ status: 'Review' })).toEqual(['child']);
    expect(counted({}, { parent: { build: { phase: 'starting' } } })).toEqual(['parent', 'child']);
    expect(
        counted({ threads: [{ id: 'build', purpose: 'build', state: 'running', updated: 'now', title: 'Build' }] }),
    ).toEqual(['parent', 'child']);
});

it('S08 F01: every started build retains its slot throughout Pedro waits and handoffs', () => {
    const items = ['Needs you', 'Shaping', 'Verify', 'Ready to merge'].map(
        (status, i) =>
            ({
                id: `${i}`,
                kind: 'build',
                status,
                buildPhase: 'implement',
                threads: [],
                linkedPrs: [],
                slices: [],
            }) as unknown as Item,
    );

    expect(buildsAtWork({ items })).toEqual(items);
    expect(buildsAtWork({ items: items.map((item) => ({ ...item, setAside: true })) })).toEqual([]);
});

it('S08 F03: only a live Doubt child makes the review label claim running', () => {
    const item = {
        briefReviewing: true,
        threads: [{ purpose: 'shape', state: 'done', doubtRunning: true }],
    } as unknown as Item;

    expect(buildActivity(item)).toEqual({ label: 'Doubt reviewing', running: true });
    expect(buildActivity(item, true)).toEqual({ label: "Brief changed; Doubt hasn't run", running: false });
    expect(buildActivity({ ...item, threads: [] })).toEqual({
        label: "Brief changed; Doubt hasn't run",
        running: false,
    });
});

it('PR links and status labels cannot create factory reservations, and terminal PRs release legacy builds', () => {
    const base = { kind: 'build', threads: [], slices: [], linkedPrs: [] } as unknown as Item;
    const items = [
        { ...base, id: 'status-only', status: 'In progress' },
        ...(['open', 'closed', 'merged'] as const).map((state) => ({
            ...base,
            id: state,
            status: 'List',
            linkedPrs: [{ state }],
        })),
        ...(['closed', 'merged'] as const).map((state) => ({
            ...base,
            id: `factory-${state}`,
            status: 'Review',
            buildStarted: true,
            linkedPrs: [{ state }],
        })),
    ] as Item[];

    expect(buildsAtWork({ items })).toEqual([]);
});
