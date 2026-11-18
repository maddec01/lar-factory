import { expect, it, vi } from 'vite-plus/test';

import { subscribeExecution } from './execution-protocol.ts';
import { ReadSession } from './read-session.ts';

const protocol = new ReadSession({
    vault: { read: async () => undefined, write: async () => {} },
    authority: {
        issue: async () => {
            throw Error();
        },
        revoke: async () => {},
    },
});

it('refuses external origins before obtaining a session', () => {
    expect(() => subscribeExecution(new URL('http://example.com'), 'unknown', protocol, 'thread', () => {})).toThrow(
        'Expected local T3 server',
    );
});

it('retains execution on disconnect and rejects stale reconnect snapshots', async () => {
    vi.useFakeTimers();

    class Socket extends EventTarget {
        static OPEN = 1;
        static instances: Socket[] = [];
        readyState = 1;
        constructor() {
            super();
            Socket.instances.push(this);
        }
        send() {}
        close() {
            this.readyState = 3;
            this.dispatchEvent(new Event('close'));
        }
        snapshot(sequence: number) {
            this.dispatchEvent(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        _tag: 'Chunk',
                        requestId: '1',
                        values: [
                            {
                                kind: 'snapshot',
                                snapshotSequence: sequence,
                                projection: {
                                    thread: { id: 'thread' },
                                    updatedAt: '2026-10-31T00:00:00Z',
                                    runs: [],
                                    attempts: [],
                                    nodes: [],
                                    subagents: [],
                                    providerSessions: [],
                                    providerThreads: [],
                                    providerTurns: [],
                                    runtimeRequests: [],
                                    messages: [],
                                },
                            },
                        ],
                    }),
                }),
            );
        }
    }

    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('fetch', async () => Response.json({ ticket: 'fixture' }));

    const session = { token: 'fixture', sessionId: 'fixture', expiresAt: '2099-01-01' };
    const authenticated = new ReadSession({
        vault: { read: async () => session, write: async () => {} },
        authority: { issue: async () => session, revoke: async () => {} },
    });
    const changed = vi.fn();
    const stop = subscribeExecution(
        new URL('http://127.0.0.1:3773'),
        '0.1.6-nightly.20261031.3977',
        authenticated,
        'thread',
        changed,
    );

    try {
        await vi.advanceTimersByTimeAsync(0);
        Socket.instances[0]!.snapshot(4);

        const observation = changed.mock.calls.at(-1)![0].observation;

        Socket.instances[0]!.close();
        expect(changed).toHaveBeenLastCalledWith({ availability: 'unavailable', observation });
        await vi.advanceTimersByTimeAsync(1000);
        Socket.instances[1]!.snapshot(3);
        expect(changed).toHaveBeenLastCalledWith({ availability: 'unavailable', observation });
        Socket.instances[1]!.snapshot(5);
        expect(changed.mock.calls.at(-1)![0].availability).toBe('available');
    } finally {
        stop();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    }
});
