// Edit in Settings › Repositories: loads an onboarded repository's .lar-factory.json from its default branch with the
// repository's labels, and saves new values through a PR. Save first creates the custom labels the repository lacks,
// then commits only .lar-factory.json, at the version the file had, with the Git data API on the default branch's head,
// puts lar-factory/edit-config on that commit and opens the PR. The board keeps reading the default branch, so the
// values change there once the PR merges.

import { missingCustomLabels, onboardingConfigFile, type RepositoryConfigAnswers } from '@lar-factory/shared';
import {
  branchExists, commitTree, createBranch, createCommit, createLabel, createPr, createTree, defaultBranchHead, listLabels, message, moveBranch, openPrFrom,
} from '../github/github.ts';
import { findRepositoryConfig, isConfigAnswers, isRepo } from './repository-config.ts';

const EDIT_BRANCH = 'lar-factory/edit-config';
const TITLE = "chore: edit lar Factory's Repository config";
const BODY = 'This PR changes `.lar-factory.json`, the Repository config lar Factory reads for this repository, as Edit in the board\'s '
  + 'Settings › Repositories saved it. The board keeps the default branch\'s values until this PR merges.';

type Run = (args: string[]) => Promise<string>;
type Refused = { status: number; error: string };

/** The repository's .lar-factory.json, with its version, or why Edit can't use it. */
async function currentConfig(repo: string, run?: Run): Promise<(RepositoryConfigAnswers & { version: number }) | Refused> {
  const found = await findRepositoryConfig(repo, run);
  if (!found) return { status: 409, error: `${repo} has no .lar-factory.json on its default branch.` };
  if ('problem' in found) return { status: 409, error: found.problem };
  const { version, itemSource, show, role, labels } = found;
  return { version, itemSource, show, role, labels };
}

/** The body's repository's .lar-factory.json values, as its default branch has them, and the repository's labels; or why Edit can't load them. */
export async function readEditConfig(input: Record<string, unknown>, run?: Run): Promise<{ config: RepositoryConfigAnswers; labels: string[] } | Refused> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository to edit.' };
  try {
    const [current, labels] = await Promise.all([currentConfig(repo, run), listLabels(repo, run)]);
    if ('error' in current) return current;
    const { version: _, ...config } = current;
    return { config, labels };
  } catch (err) {
    return { status: 502, error: `Can't read ${repo}'s .lar-factory.json and labels: ${message(err)}` };
  }
}

/**
 * Saves the body's `config` for its `repo`: creates each custom label the repository lacks, then opens a PR from
 * lar-factory/edit-config whose one commit writes .lar-factory.json at the version the default branch's has. Refuses
 * while that branch has an open PR; a branch left without one moves to the new commit. Answers the PR's URL, or the
 * status and problem with gh's message; a label that can't be created opens no PR.
 */
export async function openEditPr(input: Record<string, unknown>, run?: Run): Promise<{ prUrl: string } | Refused> {
  const { repo, config } = input;
  if (!isRepo(repo) || !isConfigAnswers(config)) return { status: 400, error: "Send the repository and its .lar-factory.json's values." };
  const labels = config.labels.map((l) => l.trim());
  let current, exists, open, present;
  try {
    current = await currentConfig(repo, run);
    exists = await branchExists(repo, EDIT_BRANCH, run);
    open = exists ? await openPrFrom(repo, EDIT_BRANCH, run) : null;
    present = await listLabels(repo, run);
  } catch (err) {
    return { status: 502, error: `Can't read ${repo}'s .lar-factory.json, labels and Edit branch: ${message(err)}` };
  }
  if ('error' in current) return current;
  if (open) return { status: 409, error: `${repo} has an Edit PR open already: ${open}` };
  for (const name of missingCustomLabels(present, labels)) {
    try { await createLabel(repo, { name }, run); }
    catch (err) { return { status: 502, error: `Couldn't create ${name} in ${repo}: ${message(err)}` }; }
  }
  try {
    const head = await defaultBranchHead(repo, run);
    const content = onboardingConfigFile({ ...config, role: config.role.trim(), labels }, current.version);
    const tree = await createTree(repo, (await commitTree(repo, head.sha, run)).sha, [{ path: '.lar-factory.json', mode: '100644', content }], run);
    const commit = await createCommit(repo, TITLE, tree, head.sha, run);
    if (exists) await moveBranch(repo, EDIT_BRANCH, commit, run);
    else await createBranch(repo, EDIT_BRANCH, commit, run);
    return { prUrl: await createPr(repo, { base: head.branch, head: EDIT_BRANCH, title: TITLE, body: BODY }, run) };
  } catch (err) {
    return { status: 502, error: `Can't open ${repo}'s Edit PR: ${message(err)}` };
  }
}
