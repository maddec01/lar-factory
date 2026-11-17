import { it, expect } from 'vite-plus/test';

import { buildActivity, buildsAtWork, canRetryBuild, type Item, type StartProgress } from './model.ts';

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

it('PR links and status labels cannot create factory reservations, and any linked PR releases legacy builds', () => {
    const base = { kind: 'build', threads: [], slices: [], linkedPrs: [] } as unknown as Item;
    const items = [
        { ...base, id: 'status-only', status: 'In progress' },
        ...(['open', 'closed', 'merged'] as const).map((state) => ({
            ...base,
            id: state,
            status: 'List',
            linkedPrs: [{ state }],
        })),
        ...(['open', 'closed', 'merged'] as const).map((state) => ({
            ...base,
            id: `factory-${state}`,
            status: 'Review',
            buildStarted: true,
            linkedPrs: [{ state }],
        })),
    ] as Item[];

    expect(buildsAtWork({ items })).toEqual([]);
});
