import { expect, it, vi } from 'vite-plus/test';
import { readExecution, readThreadFamily, subscribeExecution, subscribeExecutionShell, executionCapabilities } from './execution-protocol.ts';
import { ProjectProtocol } from './project-protocol.ts';
const protocol = new ProjectProtocol({ read: async () => undefined, write: async () => {} },
  { issue: async () => { throw Error(); }, revoke: async () => {} }, async () => new Response(), 'unknown');
it('reports unsupported lookup and family without credentials or waiting for timeout', async () => {
  const origin = new URL('http://127.0.0.1:3773');
  expect(await readExecution(origin, 'unknown', protocol, 'thread')).toEqual({ availability: 'unsupported-version', observation: undefined });
  expect(await readThreadFamily(origin, 'unknown', protocol, 'thread')).toEqual({ availability: 'unsupported-version' });
});
it('refuses external origins before obtaining a session', () => {
  expect(() => subscribeExecution(new URL('http://example.com'), 'unknown', protocol, 'thread', () => {})).toThrow('Expected local T3 server');
});

it('reports exact capability gaps and rejects external shell origins', () => {
  expect(executionCapabilities.azurePolicies).toBe(false);
  expect(executionCapabilities.transcriptUsage).toBe(false);
  expect(() => subscribeExecutionShell(new URL('http://example.com'), 'unknown', protocol, () => {})).toThrow('Expected local T3 server');
});

it('retains execution on disconnect and rejects stale reconnect snapshots', async () => {
  vi.useFakeTimers();
  class Socket extends EventTarget {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    constructor() { super(); Socket.instances.push(this); }
    send() {}
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    snapshot(sequence: number) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ _tag: 'Chunk', requestId: '1', values: [{ kind: 'snapshot', snapshotSequence: sequence, projection: {
        thread: { id: 'thread' }, updatedAt: '2026-10-31T00:00:00Z', runs: [], attempts: [], nodes: [], subagents: [], providerSessions: [], providerThreads: [], providerTurns: [], runtimeRequests: [], messages: [],
      } }] }) }));
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', async () => Response.json({ ticket: 'fixture' }));
  const session = { token: 'fixture', sessionId: 'fixture', expiresAt: '2099-01-01' };
  const authenticated = new ProjectProtocol({ read: async () => session, write: async () => {} },
    { issue: async () => session, revoke: async () => {} }, async () => new Response(), 'unused');
  const changed = vi.fn();
  const stop = subscribeExecution(new URL('http://127.0.0.1:3773'), '0.1.6-nightly.20261030.3917', authenticated, 'thread', changed);
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
  } finally { stop(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});
