import { buildBranch, type Item } from '@lar-factory/shared';
import { prHost } from '../config/pr-host.ts';
import { runTool } from '../tools/run-tool.ts';

interface RecoveryInput {
  repository: string;
  checkout: string;
  item: Item;
  branch?: string | null;
  recordedPr?: string | null;
  provider?: Pick<ReturnType<typeof prHost>, 'prState' | 'openPrByHead'>;
  git?: typeof runTool;
}

/** Reads local checkout and provider state without changing either. */
export async function inspectWorkRecovery(input: RecoveryInput): Promise<{
  branch: string; branchExists: boolean; worktreePath: string | null;
  pr: 'open' | 'none' | 'unknown'; warning?: string;
}> {
  const branch = input.branch || buildBranch(input.item);
  const git = input.git ?? runTool;
  const ref = `refs/heads/${branch}`;
  const exists = await git('git', ['-C', input.checkout, 'show-ref', '--verify', '--quiet', ref], { timeout: 10_000 });
  if (exists.code !== 0 && exists.code !== 1) throw new Error('Cannot inspect the local branch');
  const trees = await git('git', ['-C', input.checkout, 'worktree', 'list', '--porcelain'], { timeout: 10_000 });
  if (trees.code !== 0) throw new Error('Cannot inspect local worktrees');
  const worktreePath = trees.stdout.split('\n\n').find(block => block.split('\n').includes(`branch ${ref}`))?.split('\n').find(line => line.startsWith('worktree '))?.slice(9) ?? null;
  const provider = input.provider ?? prHost(input.repository);
  let pr: 'open' | 'none' | 'unknown' = 'none';
  try {
    const recorded = input.recordedPr ? await provider.prState(input.recordedPr) : null;
    const found = await provider.openPrByHead(input.repository, branch);
    if (recorded === 'OPEN' || found) pr = 'open';
  } catch { pr = 'unknown'; }
  return { branch, branchExists: exists.code === 0, worktreePath, pr,
    ...(pr === 'unknown' ? { warning: 'PR observation failed. Continuing may create a second PR. Deleting a remote branch can close its PR.' } : {}) };
}
