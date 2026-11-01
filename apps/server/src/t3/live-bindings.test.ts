import { expect, it } from 'vite-plus/test';
import { liveBindings } from './item-execution.ts';
it('includes live slice and child worktrees', () => {
  expect(liveBindings([{ id: 'slice', status: 'running', worktreePath: '/slice' }, { id: 'child', status: 'waiting', worktreePath: '/child' }, { status: 'completed', worktreePath: '/old' }])).toEqual(['/slice', '/child']);
});
it('refuses unknown live bindings and resolves project roots', () => {
  expect(liveBindings([{ status: 'running' }])).toBeUndefined();
  expect(liveBindings([{ status: 'running', projectId: 'project', worktreePath: null }], [{ id: 'project', workspaceRoot: '/main' }])).toEqual(['/main']);
});
