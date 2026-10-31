import { afterEach, expect, it, vi } from 'vite-plus/test';
import { subscribeBoardProjects } from './board-projects.ts';
import { subscribeProjects } from './project-subscription.ts';
import { ProjectProtocol } from './project-protocol.ts';

const session = { token: 'fixture', sessionId: 'fixture', expiresAt: '2099-01-01' };
const protocol = () => new ProjectProtocol({ read: async () => session, write: async () => {} },
  { issue: async () => session, revoke: async () => {} }, async () => new Response(), 'fixture-release');
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('reports rejected authentication and cancels its retry on cleanup', async () => {
  vi.useFakeTimers();
  const request = vi.fn(async () => new Response('', { status: 401 }));
  vi.stubGlobal('fetch', request);
  const changed = vi.fn();
  const close = subscribeProjects(new URL('http://127.0.0.1:3773'), 'fixture-release', protocol(), changed);
  await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledWith({ availability: 'renewal-required' });
  close();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['0.1.6-nightly.20261031.3977', '1.0.0', 'unknown', ''])('attempts authenticated subscription on T3 %s', async version => {
  vi.useFakeTimers();
  const request = vi.fn(async () => new Response('', { status: 401 }));
  vi.stubGlobal('fetch', request);
  const changed = vi.fn();
  const close = subscribeProjects(new URL('http://127.0.0.1:3773'), version, protocol(), changed);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ availability: 'renewal-required' });
  } finally { close(); }
});

it('validates local origins before obtaining credentials', () => {
  expect(() => subscribeBoardProjects('https://example.com', 'fixture-release', () => {})).toThrow('Expected local T3 server');
});
it('retains observations across disconnect and requests a fresh snapshot', async () => {
  vi.useFakeTimers();
  class Socket extends EventTarget {
    static OPEN = 1;
    static instances: Socket[] = [];
    readyState = 1;
    sent: unknown[] = [];
    constructor() { super(); Socket.instances.push(this); }
    send(value: string) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    chunk(values: unknown[]) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ _tag: 'Chunk', requestId: '1', values }) })); }
  }
  vi.stubGlobal('WebSocket', Socket);
  const request = vi.fn(async () => Response.json({ ticket: 'fixture' }));
  vi.stubGlobal('fetch', request);
  const changed = vi.fn();
  const close = subscribeProjects(new URL('http://127.0.0.1:3773'), '0.1.6-nightly.20261031.3977', protocol(), changed);
  await vi.advanceTimersByTimeAsync(0);
  const first = Socket.instances[0]!;
  first.dispatchEvent(new Event('open'));
  const project = { id: 'one', title: 'One', workspaceRoot: '/one' };
  first.chunk([{ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [project] } }]);
  first.chunk([{ kind: 'snapshot', resolvedRepositoryIdentityRoots: [], snapshot: { snapshotSequence: 3, projects: [] } }]);
  expect(changed.mock.calls.at(-1)![0].observation.projects).toEqual([project]);
  const observation = changed.mock.calls.at(-1)![0].observation;
  first.chunk([{ kind: 'project.removed', sequence: 2, projectId: 'one' }]);
  first.close();
  expect(changed).toHaveBeenLastCalledWith({ availability: 'unavailable', observation });
  await vi.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(2);
  const second = Socket.instances[1]!;
  second.dispatchEvent(new Event('open'));
  expect(second.sent[0]).toEqual({ _tag: 'Request', id: '1', tag: 'orchestration.subscribeShell', payload: { requestCompletionMarker: true }, headers: [] });
  second.chunk([{ kind: 'snapshot', snapshot: { snapshotSequence: 4, projects: [] } }]);
  expect(changed.mock.calls.at(-1)![0].observation.projects).toEqual([]);
  close();
  expect(vi.getTimerCount()).toBe(0);
});

it('renews a healthy subscription before expiry and reports failed renewal', async () => {
  vi.useFakeTimers();
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    send() { this.dispatchEvent(new MessageEvent('message', { data: '{"_tag":"Pong"}' })); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ticket: 'fixture' })));
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const authority = { issue: vi.fn(async () => { throw Error('denied'); }), revoke: async () => {} };
  const authenticated = new ProjectProtocol({ read: async () => ({ ...session, expiresAt }), write: async () => {} }, authority,
    async () => new Response(), 'fixture-release');
  const changed = vi.fn();
  const stop = subscribeProjects(new URL('http://127.0.0.1:3773'), 'fixture-release', authenticated, changed);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(authority.issue).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(authority.issue).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith({ availability: 'renewal-required' });
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
