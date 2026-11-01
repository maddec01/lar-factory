import { buildBranch, type Item } from '@lar-factory/shared';
import { prHost } from '../config/pr-host.ts';
import { runTool } from '../tools/run-tool.ts';

export interface CleanupPlan {
  branch: string;
  localBranches: string[];
  worktreePaths: string[];
  dirtyFiles: string[];
  unpushedCommits: string[];
  remoteBranch: string | null;
  localAvailable: boolean;
  remoteAvailable: boolean;
  warning?: string;
}

/** Inspect only refs owned by this build, without changing Git or the provider. */
export async function inspectCleanup(input: {
  repository: string; checkout: string; item: Item; branch?: string | null;
  sliceIds: string[]; liveWorktreePaths: string[]; defaultBranch: string;
  writable: boolean; provider?: Pick<ReturnType<typeof prHost>, 'branchExists' | 'openPrByHead'>;
  git?: typeof runTool;
}): Promise<CleanupPlan> {
  const branch = input.branch || buildBranch(input.item);
  const git = input.git ?? runTool;
  const read = async (cwd: string, args: string[]) => {
    const result = await git('git', ['-C', cwd, ...args], { timeout: 10_000 });
    if (result.code !== 0) throw new Error('Cannot inspect cleanup Git state');
    return result.stdout;
  };
  const refs = (await read(input.checkout, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).trim().split('\n').filter(Boolean);
  const trees = (await read(input.checkout, ['worktree', 'list', '--porcelain'])).split('\n\n').map(block => ({
    path: block.split('\n').find(line => line.startsWith('worktree '))?.slice(9),
    branch: block.split('\n').find(line => line.startsWith('branch refs/heads/'))?.slice(18),
  }));
  const owned = refs.filter(ref => ref === branch || input.sliceIds.some(id => ref.startsWith(`slice/${id.slice(0, 8)}-`)));
  const localBranches = owned.filter(ref => ref !== input.defaultBranch && !trees.some(tree => tree.branch === ref && tree.path && input.liveWorktreePaths.includes(tree.path)));
  const worktreePaths = trees.filter(tree => tree.branch && localBranches.includes(tree.branch) && tree.path).map(tree => tree.path!);
  const dirtyFiles: string[] = [];
  const unpushedCommits: string[] = [];
  for (const path of worktreePaths) {
    const status = await read(path, ['status', '--porcelain']);
    dirtyFiles.push(...status.split('\n').filter(Boolean).map(line => `${path}: ${line}`));
  }
  for (const ref of localBranches) {
    const upstream = await read(input.checkout, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${ref}`]);
    const base = upstream.trim() || input.defaultBranch;
    const commits = await read(input.checkout, ['log', '--format=%h %s', `${base}..refs/heads/${ref}`, '--']);
    unpushedCommits.push(...commits.split('\n').filter(Boolean).map(line => `${ref}: ${line}`));
  }
  let remoteBranch: string | null = null;
  let remoteAvailable = false;
  let warning: string | undefined;
  try {
    const provider = input.provider ?? prHost(input.repository);
    const pushed = await provider.branchExists(input.repository, branch);
    const open = await provider.openPrByHead(input.repository, branch);
    remoteBranch = pushed ? branch : null;
    remoteAvailable = pushed && input.writable && !open;
  } catch {
    remoteAvailable = input.writable;
    warning = 'PR or remote observation failed. A new branch or move could create a second PR. Deleting the remote branch could close an open PR.';
  }
  if (branch === input.defaultBranch || trees.some(tree => tree.branch === branch && tree.path && input.liveWorktreePaths.includes(tree.path))) remoteAvailable = false;
  return { branch, localBranches, worktreePaths, dirtyFiles, unpushedCommits, remoteBranch, localAvailable: localBranches.length > 0, remoteAvailable, ...(warning ? { warning } : {}) };
}

/** Execute a freshly inspected selection, retaining failed targets for retry. */
export async function executeCleanup(input: {
  plan: CleanupPlan;
  expectedPlan: CleanupPlan;
  checkout: string;
  repository: string;
  local: boolean;
  remote: boolean;
  confirmedLoss: boolean;
  git?: typeof runTool;
  provider?: Pick<ReturnType<typeof prHost>, 'deleteRemoteBranch'>;
}): Promise<{ errors: string[]; remainingBranches: string[] }> {
  if (JSON.stringify(input.plan) !== JSON.stringify(input.expectedPlan)) throw new Error('Cleanup changed. Inspect and confirm again.');
  const { plan } = input;
  if (input.local && (plan.dirtyFiles.length || plan.unpushedCommits.length) && !input.confirmedLoss) throw new Error('Confirm loss of dirty files and unpushed commits.');
  if (input.remote && !plan.remoteAvailable) throw new Error('Remote cleanup is unavailable.');
  const git = input.git ?? runTool;
  const errors: string[] = [];
  const remaining = new Set(plan.localBranches);
  if (input.local) {
    for (const path of plan.worktreePaths) {
      const result = await git('git', ['-C', input.checkout, 'worktree', 'remove', ...(input.confirmedLoss ? ['--force'] : []), '--', path], { timeout: 10_000 });
      if (result.code !== 0) errors.push(`Could not remove worktree ${path}`);
    }
    for (const branch of plan.localBranches) {
      const result = await git('git', ['-C', input.checkout, 'branch', input.confirmedLoss ? '-D' : '-d', '--', branch], { timeout: 10_000 });
      if (result.code === 0) remaining.delete(branch);
      else errors.push(`Could not delete branch ${branch}`);
    }
  }
  if (input.remote) {
    try { await (input.provider ?? prHost(input.repository)).deleteRemoteBranch(input.repository, plan.remoteBranch ?? plan.branch); }
    catch { errors.push(`Could not delete remote branch ${plan.branch}`); remaining.add(plan.branch); }
  } else if (plan.remoteBranch || plan.warning) remaining.add(plan.branch);
  return { errors, remainingBranches: [...remaining] };
}
