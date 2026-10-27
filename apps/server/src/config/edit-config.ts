// Edit in Settings › Repositories: loads an onboarded repository's .lar-factory.json with the repository's labels, and
// saves new values through a PR. Save first creates the custom labels the repository lacks, then commits only
// .lar-factory.json, at the version the file had, with the Git data API. With no Edit PR open the commit goes on the
// default branch's head, lar-factory/edit-config moves to it and the PR opens. While an Edit PR is open, Edit loads the
// file from its branch and Save adds the commit to that branch, so the open PR carries the new values. The board keeps
// reading the default branch, so the values change there once the PR merges.

import { missingCustomLabels, onboardingConfigFile, type RepositoryConfigAnswers } from '@lar-factory/shared';
import {
  branchHead, commitTree, createBranch, createCommit, createLabel, createPr, createTree, defaultBranchHead, listLabels, message, moveBranch, openPrFrom,
} from '../github/github.ts';
import { findRepositoryConfig, isConfigAnswers, isRepo } from './repository-config.ts';

const EDIT_BRANCH = 'lar-factory/edit-config';
const TITLE = "chore: edit lar Factory's Repository config";
const BODY = 'This PR changes `.lar-factory.json`, the Repository config lar Factory reads for this repository, as Edit in the board\'s '
  + 'Settings › Repositories saved it. The board keeps the default branch\'s values until this PR merges.';

type Run = (args: string[]) => Promise<string>;
type Refused = { status: number; error: string };

/** The repository's .lar-factory.json on `branch`, or its default branch without one, with its version, or why Edit can't use it. */
async function currentConfig(repo: string, run?: Run, branch?: string): Promise<(RepositoryConfigAnswers & { version: number }) | Refused> {
  const found = await findRepositoryConfig(repo, run, branch);
  if (!found) return { status: 409, error: `${repo} has no .lar-factory.json on ${branch ?? 'its default branch'}.` };
  if ('problem' in found) return { status: 409, error: found.problem };
  const { version, itemSource, show, role, labels } = found;
  return { version, itemSource, show, role, labels };
}

/** The URL of the repository's open Edit PR, the open PR from lar-factory/edit-config, or null when it has none. */
export const editPrOf = (repo: string, run?: Run) => openPrFrom(repo, EDIT_BRANCH, run);

/**
 * Each repository's open Edit PR, by repository, as gh finds it now; a repository whose PR gh can't read has none, and
 * `failed` gets its problem.
 */
export async function readEditPrs(repos: readonly string[], run?: Run, failed: (repo: string, problem: string) => void = () => {}): Promise<Map<string, string>> {
  const found = await Promise.all(repos.map((repo) => editPrOf(repo, run).then((url): [string, string | null] => [repo, url], (err: unknown) => {
    failed(repo, message(err));
    return [repo, null];
  })));
  return new Map(found.filter((entry): entry is [string, string] => entry[1] !== null));
}

/**
 * The body's repository's .lar-factory.json values and the repository's labels; or why Edit can't load them. The
 * values come from the open Edit PR's branch, named as `editPr`, while there is one, else from the default branch.
 */
export async function readEditConfig(input: Record<string, unknown>, run?: Run): Promise<{ config: RepositoryConfigAnswers; labels: string[]; editPr?: string } | Refused> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository to edit.' };
  try {
    const open = await editPrOf(repo, run);
    const [current, labels] = await Promise.all([currentConfig(repo, run, open ? EDIT_BRANCH : undefined), listLabels(repo, run)]);
    if ('error' in current) return current;
    const { version: _, ...config } = current;
    return { config, labels, ...open && { editPr: open } };
  } catch (err) {
    return { status: 502, error: `Can't read ${repo}'s .lar-factory.json and labels: ${message(err)}` };
  }
}

/**
 * Saves the body's `config` for its `repo`: creates each custom label the repository lacks, then commits
 * .lar-factory.json at the version the file it replaces has. While an Edit PR is open the commit follows its branch's
 * head and the branch moves to it; otherwise it goes on the default branch's head, lar-factory/edit-config is made or,
 * left without an open PR, moved there, and the PR opens. Answers the PR's URL, or the status and problem with gh's
 * message; a label that can't be created commits nothing.
 */
export async function openEditPr(input: Record<string, unknown>, run?: Run): Promise<{ prUrl: string } | Refused> {
  const { repo, config } = input;
  if (!isRepo(repo) || !isConfigAnswers(config)) return { status: 400, error: "Send the repository and its .lar-factory.json's values." };
  const labels = config.labels.map((l) => l.trim());
  let open, current, edited, present;
  try {
    open = await editPrOf(repo, run);
    current = await currentConfig(repo, run, open ? EDIT_BRANCH : undefined);
    edited = await branchHead(repo, EDIT_BRANCH, run);
    present = await listLabels(repo, run);
  } catch (err) {
    return { status: 502, error: `Can't read ${repo}'s .lar-factory.json, labels and Edit branch: ${message(err)}` };
  }
  if ('error' in current) return current;
  for (const name of missingCustomLabels(present, labels)) {
    try { await createLabel(repo, { name }, run); }
    catch (err) { return { status: 502, error: `Couldn't create ${name} in ${repo}: ${message(err)}` }; }
  }
  try {
    const head = open && edited ? { branch: EDIT_BRANCH, sha: edited } : await defaultBranchHead(repo, run);
    const content = onboardingConfigFile({ ...config, role: config.role.trim(), labels }, current.version);
    const tree = await createTree(repo, (await commitTree(repo, head.sha, run)).sha, [{ path: '.lar-factory.json', mode: '100644', content }], run);
    const commit = await createCommit(repo, TITLE, tree, head.sha, run);
    if (edited) await moveBranch(repo, EDIT_BRANCH, commit, run);
    else await createBranch(repo, EDIT_BRANCH, commit, run);
    return { prUrl: open ?? await createPr(repo, { base: head.branch, head: EDIT_BRANCH, title: TITLE, body: BODY }, run) };
  } catch (err) {
    return { status: 502, error: `Can't ${open ? 'add to' : 'open'} ${repo}'s Edit PR: ${message(err)}` };
  }
}
