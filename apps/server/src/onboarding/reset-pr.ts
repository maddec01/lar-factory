// Reset's PR for an onboarded repository, opened on GitHub without touching any checkout. Its one commit, made with the
// Git data API on the default branch's head like onboarding's, deletes .lar-factory.json and the three docs/agents/
// files the factory's agent setup writes, and removes the `## Agent skills` section from CLAUDE.md and AGENTS.md,
// leaving the rest of each file as it was. It comes from lar-factory/reset, which moves to the commit when it is left
// from before, and an open PR from it is reused with the new body.

import {
  branchHead, commitTree, createBranch, createCommit, createPr, createTree, defaultBranchHead, editPrBody, moveBranch, openPrFrom, readBlob,
  type CommitTree, type TreeEntry,
} from '../github/github.ts';
import { AGENT_DOC_PATHS, withoutAgentSkills } from './agent-setup.ts';
import { linkTarget } from './pr-changes.ts';

const RESET_BRANCH = 'lar-factory/reset';
const TITLE = "chore: remove lar Factory's setup";

type Run = (args: string[]) => Promise<string>;

/** One change of the reset PR: a file it deletes, or a file it removes the `## Agent skills` section from. */
interface ResetChange {
  kind: 'delete' | 'agent-skills';
  path: string;
}

function describe({ kind, path }: ResetChange): string {
  if (kind === 'agent-skills') return `Removes lar Factory's \`## Agent skills\` section from \`${path}\`.`;
  return path === '.lar-factory.json' ? 'Deletes `.lar-factory.json`, the Repository config lar Factory reads for this repository.' : `Deletes \`${path}\`.`;
}

const prBody = (changes: ResetChange[]) => `This PR:\n\n${changes.map((change) => `- ${describe(change)}`).join('\n')}\n\n`
  + 'Reset on the lar Factory board opened it. Once it merges, everyone who onboarded this repository loses its Repository config.';

/** The reset PR's tree entries and changes against the default branch's `tree`, whose blobs `read` gives. */
async function planReset(tree: CommitTree, read: (sha: string) => Promise<string>): Promise<{ entries: TreeEntry[]; changes: ResetChange[] }> {
  const entries: TreeEntry[] = [];
  const changes: ResetChange[] = [];
  const remove = (path: string) => {
    if (!tree.files.has(path)) return;
    entries.push({ path, mode: tree.files.get(path)!.mode, sha: null });
    changes.push({ kind: 'delete', path });
  };
  remove('.lar-factory.json');
  const edited = new Set<string>();
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    // A link leads to the file the section is in, such as CLAUDE.md to AGENTS.md, which changes once.
    const path = await linkTarget(tree, read, name);
    const file = path === null ? undefined : tree.files.get(path);
    if (!path || !file || edited.has(path)) continue;
    edited.add(path);
    const content = withoutAgentSkills(await read(file.sha));
    if (content === null) continue;
    entries.push({ path, mode: file.mode, content });
    changes.push({ kind: 'agent-skills', path });
  }
  for (const path of AGENT_DOC_PATHS) remove(path);
  return { entries, changes };
}

/**
 * Opens the repository's reset PR and returns its URL; throws gh's message when a call fails, and throws without a
 * commit when the default branch has none of the factory's setup.
 */
export async function openResetPr(repo: string, run?: Run): Promise<string> {
  const head = await defaultBranchHead(repo, run);
  const tree = await commitTree(repo, head.sha, run);
  const { entries, changes } = await planReset(tree, (sha) => readBlob(repo, sha, run));
  if (!changes.length) throw new Error("the default branch has none of lar Factory's setup to remove.");
  const commit = await createCommit(repo, TITLE, await createTree(repo, tree.sha, entries, run), head.sha, run);
  const body = prBody(changes);
  if (await branchHead(repo, RESET_BRANCH, run) === null) {
    await createBranch(repo, RESET_BRANCH, commit, run);
  } else {
    await moveBranch(repo, RESET_BRANCH, commit, run);
    const open = await openPrFrom(repo, RESET_BRANCH, run);
    if (open) {
      await editPrBody(open, body, run);
      return open;
    }
  }
  return createPr(repo, { base: head.branch, head: RESET_BRANCH, title: TITLE, body }, run);
}
