import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { launchExistingWorktree } from './existing-worktree.ts';
import { boardSessionAuthority } from './board-session.ts';
import { subscribeProjects } from './project-subscription.ts';

vi.mock('./board-session.ts');
vi.mock('./project-subscription.ts');
const workspace = { type: 'existing_worktree' as const, worktreePath: '/tmp/work', branch: 'build/test', origin: 'http://localhost:3773', commandId: 'stable' };
const choice = { instanceId: 'codex', model: 'gpt-5' };
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
describe('existing worktree launch', () => {
  it('requires a model before issuing launch authority', async () => {
    expect((await launchExistingWorktree('project', 'Continue', undefined, workspace)).thread).toBeNull();
    expect(boardSessionAuthority).not.toHaveBeenCalled();
  });
  it('reports authorization failure without sending a launch', async () => {
    vi.mocked(boardSessionAuthority).mockReturnValue({ issue: async () => { throw Error('secret'); }, revoke: vi.fn() });
    expect(await launchExistingWorktree('project', 'Continue', choice, workspace)).toEqual({ thread: null, error: 'T3 launch authorization failed.' });
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
    const result = launchExistingWorktree('project', 'Continue', choice, workspace);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ thread: null, uncertain: true });
    expect(stop).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('session');
    expect(vi.mocked(subscribeProjects).mock.calls[0]![4]!.payload).toMatchObject({ commandId: 'stable', workspaceStrategy: { type: 'existing_worktree', worktreePath: '/tmp/work', branch: 'build/test' } });
  });
});
