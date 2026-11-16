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
    expect(countedThreads(inputs).map(String).sort()).toEqual(['child', 'own']);
    expect(inputs.allObserved, 'a thread never read successfully is not observed').toBe(false);
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

it('projects the exact pending gate from a history read and drops it when the shell request changes', async () => {
    const { protocolItemThreads, protocolThreadById } = await import('./item-execution.ts');
    const observedAt = '2026-11-13T12:00:00Z';
    const projection = {
        thread: { id: 'shape' },
        messages: [],
        turnItems: [
            {
                type: 'user_input_request',
                requestId: 'gate',
                questions: [
                    {
                        header: 'Question',
                        question: 'Q3 - Revised brief approval: May this exact brief be marked Ready?',
                    },
                ],
            },
        ],
    };

    fixture.read.mockResolvedValue({ availability: 'available', observation: { observedAt, projection } });
    protocolItemThreads(['shape']);

    const shell = { id: 'shape', updatedAt: observedAt, pendingRuntimeRequest: { id: 'gate', kind: 'user_input' } };
    const publish = (thread: Record<string, unknown>) =>
        fixture.changed!({
            availability: 'available',
            observation: { observedAt, snapshot: { threads: [thread], archivedThreads: [] } },
        });

    publish(shell);
    await vi.waitFor(() => expect(protocolThreadById('shape').availability).toBe('available'));
    expect(protocolItemThreads(['shape'])?.[0]).toMatchObject({
        pendingRequest: { id: 'gate', threadId: 'shape', kind: 'brief-approval' },
        questionSummary: projection.turnItems[0]!.questions[0]!.question,
    });
    expect(protocolThreadById('shape').observation?.projection).not.toHaveProperty('turnItems');
    publish({ ...shell, pendingRuntimeRequest: { id: 'approval', kind: 'command' } });
    expect(protocolItemThreads(['shape'])?.[0]).toMatchObject({
        pendingRequest: { id: 'approval', kind: 'tool-approval' },
    });
    publish({ ...shell, pendingRuntimeRequest: null, status: 'completed' });
    expect(protocolItemThreads(['shape'])?.[0]).not.toHaveProperty('pendingRequest');
});
