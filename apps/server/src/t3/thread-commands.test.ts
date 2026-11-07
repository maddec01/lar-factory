import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { boardSessionAuthority } from './board-session.ts';
import { sendThreadCommand } from './thread-commands.ts';

vi.mock('./board-session.ts');
vi.mock('./t3-settings.ts', () => ({ serverRuntimePath: () => '/fixture/runtime' }));
const runtime = vi.hoisted(() => ({ origin: 'http://127.0.0.1:3773' as string | undefined }));
vi.mock('../json-file.ts', () => ({ readJsonRecord: () => ({ origin: runtime.origin }) }));

class FakeT3Socket extends EventTarget {
    static OPEN = 1;
    static instances: FakeT3Socket[] = [];
    readyState = 1;
    sent: { _tag: string; [key: string]: unknown }[] = [];
    constructor() {
        super();
        FakeT3Socket.instances.push(this);
    }
    send(value: string) {
        const frame = JSON.parse(value);
        this.sent.push(frame);
        if (frame._tag === 'Ping') this.answer({ _tag: 'Pong' });
    }
    close() {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
    }
    answer(frame: unknown) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
    }
    raw(data: string) {
        this.dispatchEvent(new MessageEvent('message', { data }));
    }
    requests() {
        return this.sent.filter((frame) => frame._tag === 'Request');
    }
}

const command = { type: 'thread.archive', commandId: 'stable', threadId: 'mcp:thread' } as const;
const revoke = vi.fn(async () => {});
const issue = vi.fn(async () => ({ token: 'private', sessionId: 'session', expiresAt: '2099-01-01' }));
const ticket = vi.fn(async () => Response.json({ ticket: 'fixture' }));
const opened = async () => {
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeT3Socket.instances.at(-1)!;
    socket.dispatchEvent(new Event('open'));
    return socket;
};
beforeEach(() => {
    vi.useFakeTimers();
    FakeT3Socket.instances = [];
    runtime.origin = 'http://127.0.0.1:3773';
    vi.stubGlobal('WebSocket', FakeT3Socket);
    vi.stubGlobal('fetch', ticket);
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue, revoke });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
});

it('resolves an accepted command on the first answer and revokes the session', async () => {
    const result = sendThreadCommand(command);
    const socket = await opened();
    expect(socket.requests()).toEqual([
        {
            _tag: 'Request',
            id: '1',
            tag: 'orchestration.dispatchCommand',
            payload: { type: 'thread.archive', commandId: 'stable', threadId: 'mcp:thread' },
            headers: [],
        },
    ]);
    expect(boardSessionAuthority).toHaveBeenCalledWith('t3', 'orchestration:operate');
    socket.answer({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: { sequence: 41 } } });
    expect(await result).toEqual({ outcome: 'accepted', sequence: 41 });
    expect(revoke).toHaveBeenCalledWith('session');
    expect(vi.getTimerCount()).toBe(0);
});

it("reports a rejected command with T3's reason, one request and no reconnect", async () => {
    const result = sendThreadCommand({ ...command, type: 'thread.delete' });
    const socket = await opened();
    socket.answer({
        _tag: 'Exit',
        requestId: '1',
        exit: {
            _tag: 'Failure',
            cause: [
                {
                    _tag: 'Fail',
                    error: {
                        _tag: 'OrchestrationV2DispatchCommandError',
                        commandId: 'stable',
                        commandType: 'thread.delete',
                        message: 'Thread is still running',
                    },
                },
            ],
        },
    });
    expect(await result).toEqual({ outcome: 'rejected', reason: 'Thread is still running' });
    const framesAtAnswer = socket.sent.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeT3Socket.instances).toHaveLength(1);
    expect(ticket).toHaveBeenCalledTimes(1);
    expect(socket.requests()).toHaveLength(1);
    expect(socket.sent).toHaveLength(framesAtAnswer);
    expect(socket.sent.some((frame) => frame._tag === 'Interrupt')).toBe(false);
    expect(revoke).toHaveBeenCalledWith('session');
});

it('reports a rejection without a reason', async () => {
    const result = sendThreadCommand(command);
    (await opened()).answer({
        _tag: 'Exit',
        requestId: '1',
        exit: { _tag: 'Failure', cause: [{ _tag: 'Interrupt' }] },
    });
    expect(await result).toEqual({ outcome: 'rejected', reason: 'T3 rejected thread.archive.' });
});

it('leaves the command unconfirmed when T3 does not answer in time', async () => {
    const result = sendThreadCommand(command);
    const socket = await opened();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ outcome: 'unconfirmed', reason: expect.stringContaining('timed out') });
    expect(socket.requests()).toHaveLength(1);
    expect(revoke).toHaveBeenCalledWith('session');
    expect(vi.getTimerCount()).toBe(0);
});

it.each([
    [
        'a success value without a sequence',
        (socket: FakeT3Socket) =>
            socket.answer({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: { sequence: 'one' } } }),
    ],
    [
        'an exit that is neither success nor failure',
        (socket: FakeT3Socket) => socket.answer({ _tag: 'Exit', requestId: '1', exit: 'done' }),
    ],
    ['a frame that is not JSON', (socket: FakeT3Socket) => socket.raw('not json')],
])('leaves the command unconfirmed on %s', async (_name, answer) => {
    const result = sendThreadCommand(command);
    const socket = await opened();
    answer(socket);
    expect(await result).toMatchObject({ outcome: 'unconfirmed', reason: expect.stringContaining('T3') });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(socket.requests()).toHaveLength(1);
    expect(FakeT3Socket.instances).toHaveLength(1);
    expect(revoke).toHaveBeenCalledWith('session');
    expect(vi.getTimerCount()).toBe(0);
});

it('leaves the command unconfirmed when the connection drops, without reconnecting', async () => {
    const result = sendThreadCommand(command);
    (await opened()).close();
    expect(await result).toMatchObject({ outcome: 'unconfirmed', reason: expect.stringContaining('connection') });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeT3Socket.instances).toHaveLength(1);
    expect(revoke).toHaveBeenCalledWith('session');
    expect(vi.getTimerCount()).toBe(0);
});

it('leaves the command unconfirmed when T3 refuses a connection ticket', async () => {
    ticket.mockResolvedValueOnce(new Response('', { status: 401 }));
    const result = sendThreadCommand(command);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ outcome: 'unconfirmed', reason: expect.stringContaining('connection') });
    expect(FakeT3Socket.instances).toHaveLength(0);
    expect(revoke).toHaveBeenCalledWith('session');
});

it('sends nothing when the session cannot be issued', async () => {
    issue.mockRejectedValueOnce(Error('secret'));
    expect(await sendThreadCommand(command)).toEqual({
        outcome: 'unconfirmed',
        reason: 'T3 authorization for thread.archive failed.',
    });
    expect(ticket).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
});

it('reports an unreadable or non-local T3 origin and revokes the session', async () => {
    runtime.origin = 'https://example.com';
    expect(await sendThreadCommand(command)).toMatchObject({
        outcome: 'unconfirmed',
        reason: expect.stringContaining('endpoint'),
    });
    expect(ticket).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('session');
    runtime.origin = undefined;
    expect(await sendThreadCommand(command)).toMatchObject({
        outcome: 'unconfirmed',
        reason: expect.stringContaining('endpoint'),
    });
    expect(revoke).toHaveBeenCalledTimes(2);
});

it('still resolves when revoking the session fails', async () => {
    revoke.mockRejectedValueOnce(Error('secret'));
    const result = sendThreadCommand(command);
    (await opened()).answer({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: { sequence: 0 } } });
    expect(await result).toEqual({ outcome: 'accepted', sequence: 0 });
});
