import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { launchThread } from './launch-thread.ts';
import { boardSessionAuthority } from './board-session.ts';
import { subscribeProjects } from './project-subscription.ts';

vi.mock('./board-session.ts');
vi.mock('./project-subscription.ts');
const workspace = { type: 'existing_worktree' as const, worktreePath: '/tmp/work', branch: 'build/test' };
const selection = { instanceId: 'codex', model: 'gpt-5', options: [{ id: 'reasoningEffort', value: 'high' }] };
const ORIGIN = 'http://localhost:3773';
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
describe('thread launch', () => {
  it('reports authorization failure without sending a launch', async () => {
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue: async () => { throw Error('secret'); }, revoke: vi.fn() });
    expect(await launchThread('project', 'Continue', selection, workspace, 'approval-required', ORIGIN)).toEqual({ thread: null, error: 'T3 launch authorization failed.' });
    expect(subscribeProjects).not.toHaveBeenCalled();
  });
  it('keeps malformed responses uncertain and revokes launch authority', async () => {
    vi.useFakeTimers();
    const revoke = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn();
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue: async () => ({ token: 'private', sessionId: 'session', expiresAt: '2099-01-01' }), revoke });
    vi.mocked(subscribeProjects).mockImplementation((_origin, _version, _protocol, _change, execution) => {
      execution!.accept({ threadId: 'incomplete' });
      return stop;
    });
    const result = launchThread('project', 'Continue', selection, workspace, 'approval-required', ORIGIN, 'stable');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ thread: null, uncertain: true });
    expect(stop).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('session');
    expect(vi.mocked(subscribeProjects).mock.calls[0]![4]!.payload).toMatchObject({ commandId: 'stable', workspaceStrategy: { type: 'existing_worktree', worktreePath: '/tmp/work', branch: 'build/test' } });
  });
  it('reports a missing origin without sending a launch', async () => {
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue: async () => ({ token: 'private', sessionId: 'session', expiresAt: '2099-01-01' }), revoke: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(subscribeProjects).mockImplementation(() => { throw Error('bad origin'); });
    expect(await launchThread('project', 'Continue', selection, workspace, 'approval-required', '')).toEqual({ thread: null, error: 'Invalid local T3 launch endpoint.' });
  });
  it('sends the whole selection and workspace, and tells a refusal from a lost answer', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue: async () => ({ token: 'private', sessionId: 'session', expiresAt: '2099-01-01' }), revoke });
    vi.mocked(subscribeProjects).mockImplementation((_origin, _version, _protocol, _change, execution) => {
      execution!.reject!(exit);
      return vi.fn();
    });
    let exit: unknown = { _tag: 'Interrupted' };
    const result = await launchThread('project', 'Build it\nIssue', selection, { type: 'worktree', baseRef: 'main', branch: 'build/x' }, 'full-access', ORIGIN);
    expect(result).toMatchObject({ thread: null, uncertain: true });
    expect(vi.mocked(subscribeProjects).mock.calls[0]![4]!.payload).toMatchObject({ projectId: 'project', title: 'Build it', modelSelection: selection,
      runtimeMode: 'full-access', interactionMode: 'default', workspaceStrategy: { type: 'worktree', baseRef: 'main', branch: 'build/x' } });
    expect(revoke).toHaveBeenCalledWith('session');
    exit = { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { message: 'No base ref.' } }] };
    expect(await launchThread('project', 'Build', selection, { type: 'root' }, 'full-access', ORIGIN)).toEqual({ thread: null, error: 'No base ref.' });
    exit = { _tag: 'Failure', cause: [{ _tag: 'Die', defect: 'T3 stopped' }] };
    expect(await launchThread('project', 'Build', selection, { type: 'root' }, 'full-access', ORIGIN)).toMatchObject({ thread: null, uncertain: true });
  });
  it('a dropped connection leaves the launch uncertain, with nothing unhandled', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async () => { throw Error('refused'); });
    const actual = await vi.importActual<typeof import('./project-subscription.ts')>('./project-subscription.ts');
    vi.mocked(subscribeProjects).mockImplementation(actual.subscribeProjects);
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue: async () => ({ token: 'private', sessionId: 'session', expiresAt: '2099-01-01' }), revoke: vi.fn().mockResolvedValue(undefined) });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const result = launchThread('project', 'Continue', selection, workspace, 'approval-required', ORIGIN);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toMatchObject({ thread: null, uncertain: true });
      vi.useRealTimers();
      await new Promise(resolve => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      vi.unstubAllGlobals();
    }
  });
});
