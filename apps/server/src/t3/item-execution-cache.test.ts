import type { WorkRecords } from '@lar-factory/work-records';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import type { ExecutionRead, ShellRead, ThreadFamilyRead } from './execution-protocol.ts';

const fixture = vi.hoisted(() => ({
    changed: undefined as ((read: ShellRead) => void) | undefined,
    read: vi.fn<(id: string) => Promise<ExecutionRead>>(),
    archived: vi.fn<() => Promise<ThreadFamilyRead>>(),
    runtimeReads: { count: 0 },
    running: vi.fn(() => true),
}));

vi.mock('../json-file.ts', () => ({
    readJsonRecord: () => {
        fixture.runtimeReads.count++;

        return { origin: 'http://localhost:3773', serverVersion: 'fixture', pid: 1 };
    },
}));
vi.mock('./t3-settings.ts', () => ({ serverRuntimePath: () => '/fixture', t3Running: fixture.running }));
vi.mock('./board-projects.ts', () => ({ boardProjects: () => ({}) }));
vi.mock('./execution-protocol.ts', () => ({
    subscribeExecutionShell: (
        _origin: unknown,
        _version: unknown,
        _protocol: unknown,
        changed: typeof fixture.changed,
    ) => {
        fixture.changed = changed;

        return () => {};
    },
    readExecution: (_origin: unknown, _version: unknown, _protocol: unknown, id: string) => fixture.read(id),
    readArchivedShells: () => fixture.archived(),
}));

const archivedRead = (threads: object[]): ThreadFamilyRead => ({
    availability: 'available',
    observation: {
        threads: threads as Record<string, unknown>[],
        snapshotSequence: 1,
        observedAt: '2026-10-31T12:00:00Z',
    },
});

beforeEach(() => {
    fixture.archived.mockResolvedValue(archivedRead([]));
});
afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    fixture.read.mockReset();
    fixture.archived.mockReset();
});
it("reads T3's runtime file once per synchronous pass, however many items ask, and again on the next", async () => {
    const { protocolItemThreads } = await import('./item-execution.ts');

    await Promise.resolve();
    fixture.runtimeReads.count = 0;
    for (let i = 0; i < 100; i++) protocolItemThreads([`thread-${i}`]);
    expect(fixture.runtimeReads.count).toBe(1);
    await Promise.resolve();
    protocolItemThreads(['thread']);
    expect(fixture.runtimeReads.count).toBe(2);
});
it("asks whether T3's process lives only while no subscription to it shows that it does", async () => {
    const { protocolItemThreads } = await import('./item-execution.ts');

    protocolItemThreads(['thread']);
    await Promise.resolve();
    fixture.changed!({
        availability: 'available',
        observation: { observedAt: '2026-10-31T12:00:00Z', snapshot: { threads: [], archivedThreads: [] } },
    });
    fixture.running.mockClear();
    for (let pass = 0; pass < 3; pass++) {
        protocolItemThreads(['thread']);
        await Promise.resolve();
    }
    expect(fixture.running).not.toHaveBeenCalled();
    fixture.changed!({ availability: 'unavailable' });
    protocolItemThreads(['thread']);
    await Promise.resolve();
    expect(fixture.running).toHaveBeenCalledTimes(1);
});
it('loads history once, refreshes changed threads and keeps timestamped last observations through an outage', async () => {
    const { protocolItemThreads, protocolThreadById } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';

    fixture.read.mockImplementation(async (id) => ({
        availability: 'available',
        observation: {
            observedAt,
            projection: {
                thread: { id },
                messages: [{ role: 'user', text: 'Build Owner/Repo#636', createdAt: observedAt }],
            },
        },
    }));
    protocolItemThreads(['one', 'archive']);

    const shells = [
        { id: 'one', updatedAt: observedAt },
        { id: 'archive', updatedAt: observedAt },
    ];
    const publish = (threads: Record<string, unknown>[] = shells) =>
        fixture.changed!({
            availability: 'available',
            observation: { observedAt, snapshot: { threads: [threads[0]], archivedThreads: [threads[1]] } },
        });

    publish();
    await vi.waitFor(() => expect(protocolItemThreads(['one', 'archive'])).toHaveLength(2));
    publish();
    await vi.waitFor(() => expect(protocolItemThreads(['one', 'archive'])).toHaveLength(2));
    await vi.waitFor(() => {
        expect(protocolThreadById('one').availability).toBe('available');
        expect(protocolThreadById('archive').availability).toBe('available');
    });
    expect(fixture.read).toHaveBeenCalledTimes(2);
    publish([{ ...shells[0]!, title: 'changed' }, shells[1]!]);
    expect(fixture.read).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(protocolItemThreads(['one'])).toMatchObject([{ title: 'changed' }]));
    await vi.waitFor(() => expect(protocolThreadById('one').availability).toBe('available'));
    expect(fixture.read).toHaveBeenCalledTimes(3);
    fixture.changed!({ availability: 'unavailable' });
    expect(protocolThreadById('one')).toMatchObject({ availability: 'unavailable', observation: { observedAt } });
    expect(protocolItemThreads(['one'])).toMatchObject([{ id: 'one', title: 'changed', observedAt }]);
    expect(protocolItemThreads(['one', 'never-seen'])).toBe('unavailable');
    publish();
    await vi.waitFor(() => expect(protocolItemThreads(['one', 'archive'])).toHaveLength(2));
});

it('resolves a started thread across message formats, and only when one thread matches, a cut-short title included', async () => {
    const { protocolItemThreads, protocolStartedThread } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';
    const current = 'Build #7 T\nBuild w1. Read /a/long/path/builder.md and follow it.';
    const earlier = 'Build w1. Read /a/long/path/builder.md and follow it.';
    const first: Record<string, string> = { 'in-current': current, 'in-earlier': earlier };

    fixture.read.mockImplementation(async (id) => ({
        availability: 'available',
        observation: {
            observedAt,
            projection: { thread: { id }, messages: [{ role: 'user', text: first[id], createdAt: observedAt }] },
        },
    }));
    protocolItemThreads([]);

    const shell = (id: string, title: string) => ({ id, projectId: 'p', title, updatedAt: observedAt });

    fixture.changed!({
        availability: 'available',
        observation: {
            observedAt,
            snapshot: { threads: [shell('in-earlier', 'Build w1. Read /a/long…')], archivedThreads: [] },
        },
    });
    await vi.waitFor(() =>
        expect(protocolStartedThread('p', [current, earlier], [])).toEqual({
            threadId: 'in-earlier',
            title: 'Build w1. Read /a/long…',
        }),
    );
    fixture.changed!({
        availability: 'available',
        observation: {
            observedAt,
            snapshot: {
                threads: [shell('in-earlier', 'Build w1. Read /a/long…'), shell('in-current', 'Build #7 T')],
                archivedThreads: [],
            },
        },
    });
    await vi.waitFor(() => expect(protocolStartedThread('p', [current, earlier], [])).toBeNull());
    expect(protocolStartedThread('p', [current, earlier], ['in-earlier'])).toEqual({
        threadId: 'in-current',
        title: 'Build #7 T',
    });
});

it('finds the one started thread whose first message is the start message, leaving out recorded ones', async () => {
    const { protocolItemThreads, protocolStartedThread } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';
    const message = 'Build w1. Read builder.md and follow it.';

    fixture.read.mockImplementation(async (id) => ({
        availability: 'available',
        observation: {
            observedAt,
            projection: { thread: { id }, messages: [{ role: 'user', text: message, createdAt: observedAt }] },
        },
    }));
    protocolItemThreads([]);
    expect(() => protocolStartedThread('p', [message], [])).toThrow('unavailable');

    const shell = (id: string) => ({ id, projectId: 'p', title: message, updatedAt: observedAt });

    fixture.changed!({
        availability: 'available',
        observation: { observedAt, snapshot: { threads: [shell('old'), shell('new')], archivedThreads: [] } },
    });
    await vi.waitFor(() =>
        expect(protocolStartedThread('p', [message], ['old'])).toEqual({ threadId: 'new', title: message }),
    );
    expect(protocolStartedThread('p', [message], ['old'])).toEqual({ threadId: 'new', title: message });
    await vi.waitFor(() =>
        expect(protocolStartedThread('p', [message], []), 'two matches establish nothing').toBeNull(),
    );
    expect(protocolStartedThread('other', [message], [])).toBeNull();
});

it('shows shell status changes immediately while history reads wait, without treating stale details as current', async () => {
    const { protocolItemThreads, protocolStartedThread, protocolThreadById, protocolStatsInputs } =
        await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';
    let release!: (read: ExecutionRead) => void;
    const delayed = new Promise<ExecutionRead>((resolve) => {
        release = resolve;
    });

    fixture.read.mockReturnValue(delayed);
    protocolItemThreads(['one']);

    const publish = (thread: Record<string, unknown>) =>
        fixture.changed!({
            availability: 'available',
            observation: {
                observedAt,
                snapshot: { threads: [thread], archivedThreads: [] },
            },
        });
    const shell = { id: 'one', projectId: 'p', title: 'Shape issue', updatedAt: observedAt, status: 'running' };

    publish(shell);
    expect(protocolItemThreads(['one'])).toMatchObject([{ state: 'running' }]);
    expect(protocolThreadById('one').availability).toBe('unavailable');
    expect((await protocolStatsInputs())!.familyReads(['one'])).toEqual(['never']);
    expect(() => protocolStartedThread('p', ['Shape issue'], [])).toThrow('unavailable');

    publish({ ...shell, pendingRuntimeRequest: { id: 'request' } });
    expect(protocolItemThreads(['one'])).toMatchObject([{ state: 'needs you' }]);
    release({
        availability: 'available',
        observation: { observedAt, projection: { thread: { id: 'one' }, messages: [] } },
    });
    await vi.waitFor(() => expect(protocolThreadById('one').availability).toBe('available'));
    expect(protocolItemThreads(['one'])).toMatchObject([{ state: 'needs you' }]);
    expect(fixture.read).toHaveBeenCalledTimes(2);
});

it('reads stats only for the requested thread family even when unrelated history is still loading', async () => {
    const { protocolItemThreads, protocolThreadById, protocolStatsInputs } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';

    fixture.read.mockImplementation(async (id) =>
        id === 'unrelated'
            ? new Promise<ExecutionRead>(() => {})
            : {
                  availability: 'available',
                  observation: {
                      observedAt,
                      projection: {
                          thread: { id },
                          messages: [],
                          providerSessions: [],
                          providerThreads: [],
                          providerTurns: [],
                          runtimeRequests: [],
                          subagents: [],
                      },
                  },
              },
    );
    protocolItemThreads(['own']);
    fixture.changed!({
        availability: 'available',
        observation: {
            observedAt,
            snapshot: {
                threads: [
                    { id: 'own', updatedAt: observedAt },
                    { id: 'child', updatedAt: observedAt, lineage: { rootThreadId: 'own' } },
                    { id: 'unrelated', updatedAt: observedAt },
                ],
                archivedThreads: [],
            },
        },
    });
    await vi.waitFor(() => expect(protocolThreadById('child').availability).toBe('available'));
    await vi.waitFor(async () =>
        expect((await protocolStatsInputs(['own']))!.rows.threads.map((thread) => thread.id)).toEqual(['own', 'child']),
    );
    expect(fixture.read.mock.calls.map(([id]) => id)).toEqual(['child', 'own']);
    expect((await protocolStatsInputs())!.familyReads(['unrelated'])).toEqual(['never']);
    expect((await protocolStatsInputs())!.allObserved).toBe(false);
    expect((await protocolStatsInputs([]))!.rows.threads).toEqual([]);
});

it('does not acquire histories for shell-only consumers', async () => {
    const { protocolItemThreads } = await import('./item-execution.ts');

    protocolItemThreads(['one']);

    const read: ShellRead = {
        availability: 'available',
        observation: {
            observedAt: '2026-10-31T12:00:00Z',
            snapshot: {
                threads: [{ id: 'one', updatedAt: '2026-10-31T12:00:00Z' }],
                archivedThreads: [],
            },
        },
    };

    fixture.changed!(read);
    fixture.changed!(read);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.read).not.toHaveBeenCalled();
});

it('a failing thread is read again only on demand, and not before retryAt', async () => {
    const { protocolItemThreads, protocolThreadReads } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';

    fixture.read.mockResolvedValue({ availability: 'unavailable' });
    protocolItemThreads([]);
    fixture.changed!({
        availability: 'available',
        observation: { observedAt, snapshot: { threads: [{ id: 'bad', updatedAt: observedAt }], archivedThreads: [] } },
    });

    const clock = vi.spyOn(Date, 'now');

    clock.mockReturnValue(1_000_000);
    protocolThreadReads(['bad'])!.demand();
    await vi.waitFor(() => expect(protocolThreadReads(['bad'])!.reads.get('bad')).toBe('failed'));
    expect(fixture.read).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) protocolThreadReads(['bad'])!.demand();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
        fixture.read,
        'each demand inside the wait reads nothing, and a failure asks for no read itself',
    ).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(1_001_001);
    protocolThreadReads(['bad'])!.demand();
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(2));
    clock.mockRestore();
});

it('a thread on neither list reads as failed once the archived list fails, so no catch-up waits on it', async () => {
    const { protocolItemThreads, protocolThreadReads } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';

    fixture.archived.mockResolvedValue({ availability: 'unavailable' });
    protocolItemThreads([]);
    expect(protocolThreadReads(['lost'])).toBeNull();
    fixture.changed!({
        availability: 'available',
        observation: { observedAt, snapshot: { threads: [], archivedThreads: [] } },
    });
    expect(protocolThreadReads(['lost'])!.reads.get('lost')).toBe('never');
    await vi.waitFor(() => expect(protocolThreadReads(['lost'])!.reads.get('lost')).toBe('failed'));
});

it('stats inputs answer for the reads as they stood, though a read lands after them', async () => {
    const { protocolItemThreads, protocolStatsInputs } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';

    fixture.read.mockImplementation(async (id) => ({
        availability: 'available',
        observation: {
            observedAt,
            projection: {
                thread: { id },
                messages: [],
                providerSessions: [],
                providerThreads: [],
                providerTurns: [],
                runtimeRequests: [],
                subagents: [],
            },
        },
    }));
    protocolItemThreads([]);
    fixture.changed!({
        availability: 'available',
        observation: {
            observedAt,
            snapshot: { threads: [{ id: 'late', updatedAt: observedAt }], archivedThreads: [] },
        },
    });

    const inputs = (await protocolStatsInputs(['late']))!;

    await vi.waitFor(async () =>
        expect((await protocolStatsInputs(['late']))!.familyReads(['late'])).toEqual(['current']),
    );
    expect(inputs.familyReads(['late']), 'its rows hold no read of it, so it answers for none').toEqual(['never']);
    expect(inputs.allObserved).toBe(false);
});

it('coalesces concurrent global demand, bounds reads and includes archived children', async () => {
    const { protocolItemThreads, protocolStatsInputs } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;

    fixture.read.mockImplementation(
        (id) =>
            new Promise((resolve) => {
                peak = Math.max(peak, ++active);

                const projection = {
                    thread: { id },
                    messages: [],
                    providerSessions: [],
                    providerThreads: [],
                    providerTurns: [],
                    runtimeRequests: [],
                    subagents: [],
                };

                releases.push(() => {
                    active--;
                    resolve({ availability: 'available', observation: { observedAt, projection } });
                });
            }),
    );
    protocolItemThreads([]);

    const shells = Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        updatedAt: observedAt,
        ...(i ? { lineage: { rootThreadId: '0' } } : {}),
    }));

    fixture.changed!({
        availability: 'available',
        observation: { observedAt, snapshot: { threads: shells.slice(0, 10), archivedThreads: shells.slice(10) } },
    });
    for (let i = 0; i < 3; i++) expect((await protocolStatsInputs())!.allObserved).toBe(false);
    expect(fixture.read).toHaveBeenCalledTimes(8);
    for (let batch = 0; batch < 3; batch++) {
        releases.splice(0).forEach((release) => release());
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect((await protocolStatsInputs())!.rows.threads).toHaveLength(20);
    expect((await protocolStatsInputs(['0']))!.rows.threads).toHaveLength(20);
    expect(fixture.read).toHaveBeenCalledTimes(20);
    expect(peak).toBe(8);
});

it('rejects in-flight results across an outage and reacquires on reconnect', async () => {
    const { protocolItemThreads, protocolThreadById } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';
    let release!: (read: ExecutionRead) => void;

    fixture.read.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                release = resolve;
            }),
    );

    const result: ExecutionRead = {
        availability: 'available',
        observation: { observedAt, projection: { thread: { id: 'one' }, messages: [] } },
    };

    fixture.read.mockResolvedValue(result);
    protocolItemThreads([]);

    const shell: ShellRead = {
        availability: 'available',
        observation: { observedAt, snapshot: { threads: [{ id: 'one', updatedAt: observedAt }], archivedThreads: [] } },
    };

    fixture.changed!(shell);
    expect(protocolThreadById('one').availability).toBe('unavailable');
    fixture.changed!({ availability: 'unavailable' });
    release(result);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(protocolThreadById('one').availability).toBe('unavailable');
    fixture.changed!(shell);
    await vi.waitFor(() => expect(protocolThreadById('one').availability).toBe('available'));
    expect(fixture.read).toHaveBeenCalledTimes(2);
});

it('keeps failed detail reads unavailable and retries later demand without a request burst', async () => {
    const { protocolItemThreads, protocolThreadById } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    try {
        fixture.read.mockRejectedValueOnce(Error('offline')).mockResolvedValue({
            availability: 'available',
            observation: {
                observedAt,
                projection: { thread: { id: 'one' }, messages: [] },
            },
        });
        protocolItemThreads([]);
        fixture.changed!({
            availability: 'available',
            observation: {
                observedAt,
                snapshot: { threads: [{ id: 'one', updatedAt: observedAt }], archivedThreads: [] },
            },
        });
        expect(protocolThreadById('one').availability).toBe('unavailable');
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (let i = 0; i < 10; i++) expect(protocolThreadById('one').availability).toBe('unavailable');
        expect(fixture.read).toHaveBeenCalledTimes(1);
        now.mockReturnValue(2001);
        await vi.waitFor(() => expect(protocolThreadById('one').availability).toBe('available'));
        expect(fixture.read).toHaveBeenCalledTimes(2);
    } finally {
        now.mockRestore();
    }
});

it('reads a thread cleanup state from the current snapshot only', async () => {
    const { threadCleanupState } = await import('./item-execution.ts');
    const updatedAt = '2026-10-31T12:00:00Z';
    const show = (threads: object[], archivedThreads: object[] = []) =>
        fixture.changed!({
            availability: 'available',
            observation: { observedAt: updatedAt, snapshot: { threads, archivedThreads } },
        });
    const idle = { id: 'one', updatedAt, status: 'idle' };

    expect(threadCleanupState('one')).toBe('unavailable');
    show([idle]);
    expect(threadCleanupState('one')).toEqual({ archived: false, settled: false, live: false });
    threadCleanupState('never');
    await vi.waitFor(() => expect(threadCleanupState('never')).toBe('absent'));
    show([{ ...idle, deletedAt: updatedAt }]);
    threadCleanupState('one');
    await vi.waitFor(() => expect(threadCleanupState('one')).toBe('absent'));
    show([], [{ ...idle, archivedAt: updatedAt }]);
    expect(threadCleanupState('one')).toEqual({ archived: true, settled: false, live: false });
    show([{ ...idle, settledAt: updatedAt }]);
    expect(threadCleanupState('one')).toMatchObject({ settled: true });
    show([{ ...idle, settledOverride: 'settled' }]);
    expect(threadCleanupState('one')).toMatchObject({ settled: true });
    show([{ ...idle, settledOverride: 'active' }]);
    expect(threadCleanupState('one')).toMatchObject({ settled: false });
    for (const status of ['queued', 'preparing', 'starting', 'running', 'waiting']) {
        show([{ ...idle, status }]);
        expect(threadCleanupState('one')).toMatchObject({ live: true });
    }
    show([{ ...idle, pendingRuntimeRequest: { id: 'question' } }]);
    expect(threadCleanupState('one')).toMatchObject({ live: true });
    show([
        idle,
        { id: 'child', updatedAt, status: 'idle', lineage: { parentThreadId: 'one' } },
        { id: 'grandchild', updatedAt, status: 'queued', lineage: { parentThreadId: 'child', rootThreadId: 'one' } },
    ]);
    expect(threadCleanupState('one')).toMatchObject({ live: true });
    // A retained observation can't answer once T3 goes away.
    fixture.changed!({ availability: 'unavailable' });
    expect(threadCleanupState('one')).toBe('unavailable');
});

it('counts a thread idle for cleanup only under the statuses T3 lists as idle, itself and each descendant', async () => {
    const { threadCleanupState } = await import('./item-execution.ts');
    const updatedAt = '2026-10-31T12:00:00Z';
    const show = (threads: object[]) =>
        fixture.changed!({
            availability: 'available',
            observation: { observedAt: updatedAt, snapshot: { threads, archivedThreads: [] } },
        });
    const one = (status?: string) => ({ id: 'one', updatedAt, status });

    threadCleanupState('one');
    for (const status of ['idle', 'completed', 'interrupted', 'failed', 'cancelled', 'rolled_back']) {
        show([one(status)]);
        expect(threadCleanupState('one')).toMatchObject({ live: false });
    }
    for (const status of ['blocked', 'a-status-from-a-later-t3', undefined]) {
        show([one(status)]);
        expect(threadCleanupState('one')).toMatchObject({ live: true });

        const child = { id: 'child', updatedAt, status: 'idle', lineage: { parentThreadId: 'one' } };
        const grandchild = { id: 'grandchild', updatedAt, status, lineage: { parentThreadId: 'child' } };

        show([one('idle'), child, grandchild]);
        expect(threadCleanupState('one')).toMatchObject({ live: true });
        show([one('idle'), { id: 'rooted', updatedAt, status, lineage: { rootThreadId: 'one' } }]);
        expect(threadCleanupState('one')).toMatchObject({ live: true });
        show([one('idle'), { id: 'other', updatedAt, status }]);
        expect(threadCleanupState('one')).toMatchObject({ live: false });
    }
    show([
        one('idle'),
        { id: 'gone', updatedAt, status: 'running', deletedAt: updatedAt, lineage: { parentThreadId: 'one' } },
    ]);
    expect(threadCleanupState('one')).toMatchObject({ live: false });
});

it('counts work a finished status can hide as live for cleanup, itself and each descendant', async () => {
    const { threadCleanupState } = await import('./item-execution.ts');
    const updatedAt = '2026-10-31T12:00:00Z';
    const show = (threads: object[]) =>
        fixture.changed!({
            availability: 'available',
            observation: { observedAt: updatedAt, snapshot: { threads, archivedThreads: [] } },
        });
    const one = { id: 'one', updatedAt, status: 'completed' };
    const child = { id: 'child', updatedAt, status: 'completed', lineage: { parentThreadId: 'one' } };

    threadCleanupState('one');
    for (const work of [
        { activityRunStatus: 'running' },
        { activityRunStatus: 'waiting' },
        { pendingBackgroundTasks: [{ kind: 'shell' }] },
    ]) {
        show([{ ...one, ...work }]);
        expect(threadCleanupState('one')).toMatchObject({ live: true });
        show([one, { ...child, ...work }]);
        expect(threadCleanupState('one')).toMatchObject({ live: true });
        show([one, { id: 'other', updatedAt, status: 'completed', ...work }]);
        expect(threadCleanupState('one')).toMatchObject({ live: false });
    }
    // Another T3 release may leave these out or send something else, which says nothing.
    for (const noSignal of [
        {},
        { activityRunStatus: null, pendingBackgroundTasks: [] },
        { activityRunStatus: 7, pendingBackgroundTasks: { kind: 'shell' } },
    ]) {
        show([{ ...one, ...noSignal }]);
        expect(threadCleanupState('one')).toMatchObject({ live: false });
    }
});

it('sends no cleanup command to a thread with an unknown status', async () => {
    const { threadCleanupState } = await import('./item-execution.ts');
    const { createShapingThreadSweep } = await import('../items/shaping-thread-cleanup.ts');

    threadCleanupState('one');
    fixture.changed!({
        availability: 'available',
        observation: {
            observedAt: '2026-10-31T12:00:00Z',
            snapshot: {
                threads: [{ id: 'one', updatedAt: '2026-10-31T12:00:00Z', status: 'a-status-from-a-later-t3' }],
                archivedThreads: [],
            },
        },
    });

    const send = vi.fn();
    const records = {
        pendingShapingThreadCleanups: () => [
            { threadId: 'one', workId: 'work', action: 'delete', commandId: 'command', failure: null },
        ],
    } as unknown as WorkRecords;

    await createShapingThreadSweep({ records, stateOf: threadCleanupState, lookup: vi.fn(), send, deleted: vi.fn() })();
    expect(send).not.toHaveBeenCalled();
});

const observedAt = '2026-10-31T12:00:00Z';
const shell = (id: string, more: object = {}) => ({
    id,
    title: id,
    updatedAt: observedAt,
    status: 'completed',
    ...more,
});
const showActive = (threads: object[]) =>
    fixture.changed!({
        availability: 'available',
        observation: { observedAt, snapshot: { threads, archivedThreads: [] } },
    });

it('reads the archived list only for a thread the active shells lack, and at most once in 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') });

    const { protocolItemThreads } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([shell('active')]);
    expect(protocolItemThreads(['active'])).toMatchObject([{ id: 'active' }]);
    expect(fixture.archived).not.toHaveBeenCalled();
    fixture.archived.mockResolvedValue(archivedRead([shell('put-away', { archivedAt: observedAt })]));
    protocolItemThreads(['put-away']);
    await vi.waitFor(() =>
        expect(protocolItemThreads(['put-away'])).toMatchObject([{ id: 'put-away', archived: true }]),
    );
    protocolItemThreads(['put-away']);
    expect(fixture.archived).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 30_000);
    protocolItemThreads(['put-away']);
    expect(fixture.archived).toHaveBeenCalledTimes(2);
});

it('sorts an archived thread after the unarchived ones, however recently T3 updated it', async () => {
    const { protocolItemThreads } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([shell('build')]);
    fixture.archived.mockResolvedValue(
        archivedRead([shell('shaping', { archivedAt: observedAt, updatedAt: '2026-11-01T00:00:00Z' })]),
    );
    protocolItemThreads(['build', 'shaping']);
    await vi.waitFor(() => expect(protocolItemThreads(['build', 'shaping'])).toHaveLength(2));
    expect((protocolItemThreads(['build', 'shaping']) as { id: string }[]).map((thread) => thread.id)).toEqual([
        'build',
        'shaping',
    ]);
});

it('keeps an archived thread for display when a later read fails, and answers unavailable for cleanup', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') });

    const { protocolItemThreads, threadCleanupState } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([]);
    fixture.archived.mockResolvedValue(archivedRead([shell('put-away', { archivedAt: observedAt })]));
    threadCleanupState('put-away');
    await vi.waitFor(() =>
        expect(threadCleanupState('put-away')).toEqual({ archived: true, settled: false, live: false }),
    );
    fixture.archived.mockClear();
    fixture.archived.mockResolvedValue({ availability: 'unavailable' });
    vi.setSystemTime(Date.now() + 30_000);
    expect(threadCleanupState('put-away')).toBe('unavailable');
    await vi.waitFor(() => expect(fixture.archived).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(threadCleanupState('put-away')).toBe('unavailable');
    expect(threadCleanupState('never-seen')).toBe('unavailable');
    expect(protocolItemThreads(['put-away'])).toMatchObject([{ id: 'put-away', archived: true }]);
});

it('treats an archived list with an invalid shell as a failed read', async () => {
    const { protocolItemThreads, threadCleanupState } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([shell('active')]);
    fixture.archived.mockResolvedValue(archivedRead([{ id: 'broken', updatedAt: 'never' }]));
    threadCleanupState('broken');
    await vi.waitFor(() => expect(fixture.archived).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve));
    expect(threadCleanupState('broken')).toBe('unavailable');
    expect(protocolItemThreads(['active'])).toMatchObject([{ id: 'active' }]);
});

it('rereads the archived list after a thread leaves the active shells, and a read begun before that answers nothing for cleanup', async () => {
    const { protocolItemThreads, threadCleanupState } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([shell('one'), shell('other')]);
    threadCleanupState('never');
    await vi.waitFor(() => expect(threadCleanupState('never')).toBe('absent'));

    let answer!: (read: ThreadFamilyRead) => void;

    fixture.archived.mockClear();
    fixture.archived.mockReturnValueOnce(
        new Promise((resolve) => {
            answer = resolve;
        }),
    );
    showActive([shell('other')]);
    expect(threadCleanupState('one')).toBe('unavailable');
    expect(fixture.archived).toHaveBeenCalledTimes(1);
    showActive([]);
    fixture.archived.mockResolvedValue(archivedRead([shell('one', { archivedAt: observedAt })]));
    answer(archivedRead([]));
    await new Promise((resolve) => setTimeout(resolve));
    expect(threadCleanupState('one')).toBe('unavailable');
    await vi.waitFor(() => expect(threadCleanupState('one')).toEqual({ archived: true, settled: false, live: false }));
});

it('answers from the active shell once a thread is unarchived, whatever the archived list last said', async () => {
    const { protocolItemThreads, threadCleanupState } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([]);
    fixture.archived.mockResolvedValue(archivedRead([shell('back', { archivedAt: observedAt })]));
    threadCleanupState('back');
    await vi.waitFor(() => expect(threadCleanupState('back')).toMatchObject({ archived: true }));
    showActive([shell('back')]);
    expect(threadCleanupState('back')).toEqual({ archived: false, settled: false, live: false });
    expect(protocolItemThreads(['back'])).toEqual([expect.not.objectContaining({ archived: true })]);
});

it('never finds a started thread in the archived list', async () => {
    const { protocolItemThreads, protocolStartedThread } = await import('./item-execution.ts');

    protocolItemThreads([]);
    showActive([]);

    const message = 'Build w1.';

    fixture.archived.mockResolvedValue(
        archivedRead([shell('old', { projectId: 'p', title: message, archivedAt: observedAt })]),
    );
    protocolItemThreads(['old']);
    await vi.waitFor(() => expect(protocolItemThreads(['old'])).toHaveLength(1));
    expect(protocolStartedThread('p', [message], [])).toBeNull();
    expect(fixture.read).not.toHaveBeenCalled();
});

/** A read that succeeds, whose projection the stats mapping accepts. */
const readOf = (id: string): ExecutionRead => {
    const projection = {
        thread: { id },
        messages: [],
        providerSessions: [],
        providerThreads: [],
        providerTurns: [],
        runtimeRequests: [],
        subagents: [],
    };

    return { availability: 'available', observation: { observedAt, projection } };
};
const countedThreads = (inputs: { rows: { threads: { id: unknown }[] } } | null) =>
    inputs!.rows.threads.map((thread) => thread.id);

it('answers per family: a failed read fails only the family holding that thread, and the other family still counts', async () => {
    const { protocolItemThreads, protocolStatsInputs } = await import('./item-execution.ts');

    fixture.read.mockImplementation(async (id) => (id === 'broken' ? { availability: 'unavailable' } : readOf(id)));
    protocolItemThreads([]);
    showActive([shell('own'), shell('broken'), shell('child', { lineage: { rootThreadId: 'broken' } })]);
    await protocolStatsInputs();
    await vi.waitFor(async () => expect((await protocolStatsInputs())!.familyReads(['child'])).toEqual(['current']));
    await vi.waitFor(async () =>
        expect((await protocolStatsInputs())!.familyReads(['broken'])).toEqual(['failed', 'current']),
    );

    const inputs = (await protocolStatsInputs())!;

    expect(inputs.familyReads(['own'])).toEqual(['current']);
    expect(countedThreads(inputs).sort()).toEqual(['child', 'own']);
    expect(inputs.allObserved, 'a thread never read successfully is not observed').toBe(false);
});

it('counts a changed thread from its last read while the next is pending, and a deleted thread never', async () => {
    const { protocolItemThreads, protocolStatsInputs, protocolThreadById } = await import('./item-execution.ts');

    fixture.read.mockImplementation(async (id) => readOf(id));
    protocolItemThreads([]);
    showActive([shell('one')]);
    await protocolStatsInputs(['one']);
    await vi.waitFor(async () =>
        expect((await protocolStatsInputs(['one']))!.familyReads(['one'])).toEqual(['current']),
    );
    fixture.read.mockReturnValue(new Promise<ExecutionRead>(() => {}));
    showActive([shell('one', { status: 'running' })]);

    const pending = (await protocolStatsInputs(['one']))!;

    expect(pending.familyReads(['one'])).toEqual(['pending']);
    expect(countedThreads(pending)).toEqual(['one']);
    expect(pending.allObserved).toBe(true);
    expect(protocolThreadById('one').availability, 'its other callers keep the strict check').toBe('unavailable');
    showActive([shell('one', { deletedAt: observedAt })]);

    const deleted = (await protocolStatsInputs(['one']))!;

    expect(deleted.familyReads(['one'])).toEqual(['gone']);
    expect(countedThreads(deleted)).toEqual([]);
});

it('keeps a thread whose re-read failed in the count for deduplication, and fails it until a read succeeds', async () => {
    const { protocolItemThreads, protocolStatsInputs } = await import('./item-execution.ts');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

    try {
        fixture.read.mockImplementation(async (id) => readOf(id));
        protocolItemThreads([]);
        showActive([shell('one')]);
        await protocolStatsInputs(['one']);
        await vi.waitFor(async () =>
            expect((await protocolStatsInputs(['one']))!.familyReads(['one'])).toEqual(['current']),
        );
        fixture.read.mockResolvedValueOnce({ availability: 'unavailable' });
        showActive([shell('one', { status: 'running' })]);
        await protocolStatsInputs(['one']);
        await vi.waitFor(async () =>
            expect((await protocolStatsInputs(['one']))!.familyReads(['one'])).toEqual(['failed']),
        );

        const failed = (await protocolStatsInputs(['one']))!;

        expect(countedThreads(failed)).toEqual(['one']);
        expect(failed.allObserved).toBe(true);
        now.mockReturnValue(2001);
        await protocolStatsInputs(['one']);
        await vi.waitFor(async () =>
            expect((await protocolStatsInputs(['one']))!.familyReads(['one'])).toEqual(['current']),
        );
    } finally {
        now.mockRestore();
    }
});

it('holds an unlisted thread as never read until both lists are read, and an ageing or failing archived read does not bring that back', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') });

    const { protocolItemThreads, protocolStatsInputs } = await import('./item-execution.ts');
    let answer!: (read: ThreadFamilyRead) => void;

    fixture.archived.mockReturnValueOnce(
        new Promise((resolve) => {
            answer = resolve;
        }),
    );
    protocolItemThreads([]);
    showActive([]);
    expect((await protocolStatsInputs(['lost']))!.familyReads(['lost'])).toEqual(['never']);
    expect((await protocolStatsInputs(['lost']))!.allObserved).toBe(false);
    answer(archivedRead([]));
    await vi.waitFor(async () =>
        expect((await protocolStatsInputs(['lost']))!.familyReads(['lost'])).toEqual(['gone']),
    );
    expect((await protocolStatsInputs(['lost']))!.allObserved).toBe(true);
    vi.setSystemTime(Date.now() + 31_000);
    fixture.archived.mockResolvedValue({ availability: 'unavailable' });
    expect((await protocolStatsInputs(['lost']))!.familyReads(['lost'])).toEqual(['gone']);
    await new Promise((resolve) => setTimeout(resolve));
    expect((await protocolStatsInputs(['lost']))!.familyReads(['lost'])).toEqual(['gone']);
});

it('reads a thread found on the archived list like any other, keeping its family current', async () => {
    const { protocolItemThreads, protocolStatsInputs } = await import('./item-execution.ts');

    fixture.read.mockImplementation(async (id) => readOf(id));
    fixture.archived.mockResolvedValue(archivedRead([shell('put-away', { archivedAt: observedAt })]));
    protocolItemThreads([]);
    showActive([]);
    await protocolStatsInputs(['put-away']);
    await vi.waitFor(async () =>
        expect((await protocolStatsInputs(['put-away']))!.familyReads(['put-away'])).toEqual(['current']),
    );
});

it('reads as loading while T3 runs with its thread list unread, and throws once the list fails or T3 stops', async () => {
    const { protocolStatsInputs } = await import('./item-execution.ts');

    expect(await protocolStatsInputs(['one'])).toBeNull();
    fixture.changed!({ availability: 'unavailable' });
    await expect(protocolStatsInputs(['one'])).rejects.toThrow('unavailable');
});

it("keeps only what stats read from each thread's history, and still counts it", async () => {
    const { protocolItemThreads, protocolStatsInputs, protocolThreadById } = await import('./item-execution.ts');
    const observedAt = '2026-10-31T12:00:00Z';

    fixture.read.mockImplementation(async (id) => ({
        availability: 'available',
        observation: {
            observedAt,
            projection: {
                thread: { id, title: 'Own' },
                updatedAt: observedAt,
                messages: [{ role: 'user', text: 'Build it', createdAt: observedAt }],
                providerSessions: [],
                providerThreads: [{ id: 'provider', status: 'active', createdAt: observedAt }],
                providerTurns: [
                    {
                        id: 'turn',
                        providerThreadId: 'provider',
                        status: 'completed',
                        startedAt: observedAt,
                        completedAt: observedAt,
                    },
                ],
                runtimeRequests: [],
                subagents: [],
                runs: [{ id: 'run' }],
                attempts: [{ id: 'attempt' }],
                nodes: [{ id: 'node' }],
                turnItems: [{ id: 'item' }],
                visibleTurnItems: [{ id: 'item' }],
            },
        },
    }));
    protocolItemThreads(['own']);
    fixture.changed!({
        availability: 'available',
        observation: { observedAt, snapshot: { threads: [{ id: 'own', updatedAt: observedAt }], archivedThreads: [] } },
    });
    await protocolStatsInputs(['own']);
    await vi.waitFor(() => expect(protocolThreadById('own').availability).toBe('available'));
    expect(Object.keys(protocolThreadById('own').observation!.projection).sort()).toEqual([
        'messages',
        'providerSessions',
        'providerThreads',
        'providerTurns',
        'runtimeRequests',
        'subagents',
        'thread',
    ]);

    const { rows } = (await protocolStatsInputs(['own']))!;

    expect(rows.threads).toMatchObject([{ id: 'own', title: 'Own', text: 'Build it' }]);
    expect(rows.turns).toMatchObject([{ id: 'turn', thread: 'own', status: 'completed' }]);
    expect([...rows.active]).toEqual(['provider']);
});
