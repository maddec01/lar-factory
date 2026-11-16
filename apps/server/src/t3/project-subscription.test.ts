import { afterEach, expect, it, vi } from 'vite-plus/test';

import { ProjectProtocol } from './project-protocol.ts';
import { subscribeProjects } from './project-subscription.ts';

const session = { token: 'fixture', sessionId: 'fixture', expiresAt: '2099-01-01' };
const protocol = () =>
    new ProjectProtocol(
        { read: async () => session, write: async () => {} },
        { issue: async () => session, revoke: async () => {} },
        async () => new Response(),
        'fixture-release',
    );

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
it('retains observations across disconnect and requests a fresh snapshot', async () => {
    vi.useFakeTimers();

    class Socket extends EventTarget {
        static OPEN = 1;
        static instances: Socket[] = [];
        readyState = 1;
        sent: unknown[] = [];
        constructor() {
            super();
            Socket.instances.push(this);
        }
        send(value: string) {
            this.sent.push(JSON.parse(value));
        }
        close() {
            this.readyState = 3;
            this.dispatchEvent(new Event('close'));
        }
        chunk(values: unknown[]) {
            this.dispatchEvent(
                new MessageEvent('message', { data: JSON.stringify({ _tag: 'Chunk', requestId: '1', values }) }),
            );
        }
    }

    vi.stubGlobal('WebSocket', Socket);

    const request = vi.fn(async () => Response.json({ ticket: 'fixture' }));

    vi.stubGlobal('fetch', request);

    const changed = vi.fn();
    const authenticated = protocol();
    const invalidate = vi.spyOn(authenticated, 'invalidateSession');
    const close = subscribeProjects(
        new URL('http://127.0.0.1:3773'),
        '0.1.6-nightly.20261031.3977',
        authenticated,
        changed,
    );

    await vi.advanceTimersByTimeAsync(0);

    const first = Socket.instances[0]!;

    first.dispatchEvent(new Event('open'));

    const project = { id: 'one', title: 'One', workspaceRoot: '/one', faviconPath: null, projectIcon: null };

    first.chunk([{ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [project] } }]);
    first.chunk([
        { kind: 'snapshot', resolvedRepositoryIdentityRoots: [], snapshot: { snapshotSequence: 3, projects: [] } },
    ]);
    expect(changed.mock.calls.at(-1)![0].observation.projects).toEqual([project]);

    const observation = changed.mock.calls.at(-1)![0].observation;

    first.chunk([{ kind: 'project.removed', sequence: 2, projectId: 'one' }]);
    first.close();
    expect(invalidate).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith({ availability: 'unavailable', observation });
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);

    const second = Socket.instances[1]!;

    second.dispatchEvent(new Event('open'));
    expect(second.sent[0]).toEqual({
        _tag: 'Request',
        id: '1',
        tag: 'orchestration.subscribeShell',
        payload: { requestCompletionMarker: true },
        headers: [],
    });
    second.chunk([{ kind: 'snapshot', snapshot: { snapshotSequence: 4, projects: [] } }]);
    expect(changed.mock.calls.at(-1)![0].observation.projects).toEqual([]);
    close();
    expect(vi.getTimerCount()).toBe(0);
});

it('calls an execution reject callback once and sends nothing further after a failed exit', async () => {
    vi.useFakeTimers();

    class Socket extends EventTarget {
        static OPEN = 1;
        static instances: Socket[] = [];
        readyState = 1;
        sent: { _tag: string }[] = [];
        constructor() {
            super();
            Socket.instances.push(this);
        }
        send(value: string) {
            this.sent.push(JSON.parse(value));
        }
        close() {
            this.readyState = 3;
            this.dispatchEvent(new Event('close'));
        }
    }

    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ ticket: 'fixture' })),
    );

    const reject = vi.fn();
    const changed = vi.fn();
    const stop = subscribeProjects(new URL('http://127.0.0.1:3773'), '', protocol(), changed, {
        tag: 'fixture.command',
        payload: {},
        accept() {},
        reject,
    });

    await vi.advanceTimersByTimeAsync(0);

    const socket = Socket.instances[0]!;

    socket.dispatchEvent(new Event('open'));

    const sent = socket.sent.length;
    const exit = { _tag: 'Exit', requestId: '1', exit: { _tag: 'Failure', cause: [] } };

    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify([exit, exit]) }));
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(exit.exit);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(socket.sent).toHaveLength(sent);
    expect(Socket.instances).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});
