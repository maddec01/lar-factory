// The config update notice's PR in Settings › Repositories: it rewrites an onboarded repository's .lar-factory.json in
// the app's shape at CONFIG_VERSION, keeping the file's values, through the repository's prHost. With no PR open from
// lar-factory/edit-config the commit goes on the default branch's head, the branch moves to it and the PR opens. While
// that PR is open the commit goes on its branch, so the open PR carries the change. The board keeps reading the default
// branch, so the file changes there once the PR merges. Shared settings change only through such a PR.

import { CONFIG_VERSION, onAzure, onboardingConfigFile, sameRepo, type RepositoryConfigAnswers } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { message } from '../github/github.ts';
import { prHost } from './pr-host.ts';
import { findRepositoryConfig, isRepo, readRepositoryList } from './repository-config.ts';

const EDIT_BRANCH = 'lar-factory/edit-config';
const UPDATE_TITLE = "chore: update Lar Factory's Repository config to version";
const updateBody = (version: number) => `This PR rewrites \`.lar-factory.json\`, the Repository config Lar Factory reads for this repository, `
  + `with the same values in the shape Lar Factory writes at version ${version}. Until it merges the board reads the older file, with defaults.`;

type Run = (args: string[]) => Promise<string>;
export type Refused = { status: number; error: string };

/** The repository's .lar-factory.json on `branch`, or its default branch without one, with its version, or why the config update PR can't use it. */
async function currentConfig(repo: string, run?: Run, branch?: string): Promise<(RepositoryConfigAnswers & { version: number }) | Refused> {
  const found = await findRepositoryConfig(repo, run, branch);
  if (!found) return { status: 409, error: `${repo} has no .lar-factory.json on ${branch ?? 'its default branch'}.` };
  if ('problem' in found) return { status: 409, error: found.problem };
  const { version, itemSource, show, role, labels } = found;
  return { version, itemSource, show, role, labels };
}

/**
 * Why Settings and the config update notice can't change `repo`: it is off this Mac's list or still onboarding, or the
 * list can't be read; null for an onboarded repository.
 */
export function notEditable(repo: string, dir = boardDataDir()): Refused | null {
  let entry;
  try { entry = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo)); }
  catch (err) { return { status: 409, error: message(err) }; }
  if (!entry) return { status: 409, error: `${repo} is not on this Mac's list.` };
  if (entry.onboarding) return { status: 409, error: `${repo} is still onboarding.` };
  return null;
}

/** The URL of the repository's open Edit PR, the open PR from lar-factory/edit-config, or null when it has none. */
const editPrOf = (repo: string, run?: Run) => prHost(repo).openPrFrom(repo, EDIT_BRANCH, run);

/** "labels", or "tags" on Azure DevOps. */
const labelNoun = (repo: string) => (onAzure(repo) ? 'tags' : 'labels');

/**
 * Each repository's open Edit PR, by repository, as gh or az finds it now; a repository whose PR can't be read has none, and
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
 * The config update notice's PR for the body's `repo`: rewrites .lar-factory.json with the values it has, on the open
 * Edit PR's branch while there is one, in the app's shape at `version`, as writeConfig does, joining an open Edit PR.
 * Answers the PR's URL, or the status and problem with gh's or az's message. Refuses a repository that isn't onboarded, as
 * notEditable says.
 */
export async function openConfigUpdatePr(input: Record<string, unknown>, run?: Run, version = CONFIG_VERSION, dir = boardDataDir()):
  Promise<{ prUrl: string } | Refused> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository to update.' };
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  return writeConfig(repo, run, { title: `${UPDATE_TITLE} ${version}`, body: updateBody(version) },
    async (current) => onboardingConfigFile(current, version));
}

/**
 * Commits the .lar-factory.json `contentOf` makes from the current one, or answers its refusal. While an Edit PR is
 * open the commit follows its branch's head and the branch moves to it; otherwise it goes on the default branch's head,
 * lar-factory/edit-config is made or, left without an open PR, moved there, and the PR opens with `pr`'s title and body.
 */
async function writeConfig(repo: string, run: Run | undefined, pr: { title: string; body: string },
  contentOf: (current: RepositoryConfigAnswers) => Promise<string | Refused>): Promise<{ prUrl: string } | Refused> {
  const { branchHead, createPr, defaultBranchHead, pushCommit } = prHost(repo);
  let open, current, edited;
  try {
    open = await editPrOf(repo, run);
    current = await currentConfig(repo, run, open ? EDIT_BRANCH : undefined);
    edited = await branchHead(repo, EDIT_BRANCH, run);
  } catch (err) {
    return { status: 502, error: `Can't read ${repo}'s .lar-factory.json, ${labelNoun(repo)} and Edit branch: ${message(err)}` };
  }
  if ('error' in current) return current;
  const { version: _, ...values } = current;
  const content = await contentOf(values);
  if (typeof content !== 'string') return content;
  try {
    const head = open && edited ? { branch: EDIT_BRANCH, sha: edited } : await defaultBranchHead(repo, run);
    await pushCommit(repo, EDIT_BRANCH, { message: pr.title, parent: head.sha, entries: [{ path: '.lar-factory.json', mode: '100644', content }] }, run);
    return { prUrl: open ?? await createPr(repo, { base: head.branch, head: EDIT_BRANCH, ...pr }, run) };
  } catch (err) {
    return { status: 502, error: `Can't ${open ? 'add to' : 'open'} ${repo}'s Edit PR: ${message(err)}` };
  }
}
