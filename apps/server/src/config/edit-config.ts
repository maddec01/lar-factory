// Edit in Settings › Repositories: loads an onboarded repository's .lar-factory.json with the repository's labels, and
// saves new values through a PR. Save first creates the custom labels the repository lacks, then commits only
// .lar-factory.json, at CONFIG_VERSION, through the repository's prHost. With no Edit PR open the commit goes on the default
// branch's head, lar-factory/edit-config moves to it and the PR opens. While an Edit PR is open, Edit loads the file
// from its branch and Save adds the commit to that branch, so the open PR carries the new values. The board keeps
// reading the default branch, so the values change there once the PR merges. The config update notice's PR goes the
// same way, writing the file's own values in the app's shape and CONFIG_VERSION.
// On Azure DevOps the labels are the project's tags, read through az, and Save creates none: the board writes a tag the
// first time a work item needs it, as onboarding's Labels step does there.

import { CONFIG_VERSION, missingCustomLabels, onAzure, onboardingConfigFile, sameRepo, type RepositoryConfigAnswers } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { listTags } from '../azure/azure-tags.ts';
import { createLabel, listLabels, message } from '../github/github.ts';
import { prHost } from './pr-host.ts';
import { findRepositoryConfig, isConfigAnswers, isRepo, readRepositoryList } from './repository-config.ts';

const EDIT_BRANCH = 'lar-factory/edit-config';
const TITLE = "chore: edit Lar Factory's Repository config";
const UPDATE_TITLE = "chore: update Lar Factory's Repository config to version";
const BODY = 'This PR changes `.lar-factory.json`, the Repository config Lar Factory reads for this repository, as Edit in the board\'s '
  + 'Settings › Repositories saved it. The board keeps the default branch\'s values until this PR merges.';
const updateBody = (version: number) => `This PR rewrites \`.lar-factory.json\`, the Repository config Lar Factory reads for this repository, `
  + `with the same values in the shape Lar Factory writes at version ${version}. Until it merges the board reads the older file, with defaults.`;

type Run = (args: string[]) => Promise<string>;
export type Refused = { status: number; error: string };

/** The repository's .lar-factory.json on `branch`, or its default branch without one, with its version, or why Edit can't use it. */
async function currentConfig(repo: string, run?: Run, branch?: string): Promise<(RepositoryConfigAnswers & { version: number }) | Refused> {
  const found = await findRepositoryConfig(repo, run, branch);
  if (!found) return { status: 409, error: `${repo} has no .lar-factory.json on ${branch ?? 'its default branch'}.` };
  if ('problem' in found) return { status: 409, error: found.problem };
  const { version, itemSource, show, role, labels } = found;
  return { version, itemSource, show, role, labels };
}

/**
 * Why Edit, its Save and the config update notice can't touch `repo`: it is off this Mac's list, still onboarding or
 * resetting, or the list can't be read; null for an onboarded repository.
 */
export function notEditable(repo: string, dir = boardDataDir()): Refused | null {
  let entry;
  try { entry = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo)); }
  catch (err) { return { status: 409, error: message(err) }; }
  if (!entry) return { status: 409, error: `${repo} is not on this Mac's list.` };
  if (entry.onboarding) return { status: 409, error: `${repo} is still onboarding.` };
  if (entry.resetting) return { status: 409, error: `${repo} is resetting.` };
  return null;
}

/** The URL of the repository's open Edit PR, the open PR from lar-factory/edit-config, or null when it has none. */
export const editPrOf = (repo: string, run?: Run) => prHost(repo).openPrFrom(repo, EDIT_BRANCH, run);

/** The repository's labels, or its project's tags on Azure DevOps. */
const labelsOf = (repo: string, run?: Run) => (onAzure(repo) ? listTags : listLabels)(repo, run);

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
 * The body's repository's .lar-factory.json values and the repository's labels; or why Edit can't load them. The
 * values come from the open Edit PR's branch, named as `editPr`, while there is one, else from the default branch.
 * Refuses a repository in `dir`'s list that isn't onboarded, as notEditable says.
 */
export async function readEditConfig(input: Record<string, unknown>, run?: Run, dir = boardDataDir()):
  Promise<{ config: RepositoryConfigAnswers; labels: string[]; editPr?: string } | Refused> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository to edit.' };
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  try {
    const open = await editPrOf(repo, run);
    const [current, labels] = await Promise.all([currentConfig(repo, run, open ? EDIT_BRANCH : undefined), labelsOf(repo, run)]);
    if ('error' in current) return current;
    const { version: _, ...config } = current;
    return { config, labels, ...open && { editPr: open } };
  } catch (err) {
    return { status: 502, error: `Can't read ${repo}'s .lar-factory.json and ${labelNoun(repo)}: ${message(err)}` };
  }
}

/**
 * Saves the body's `config` for its `repo`: creates each custom label the repository lacks, none on Azure DevOps, then
 * commits .lar-factory.json at CONFIG_VERSION, as writeConfig does. Answers the PR's URL, or the status and problem with
 * gh's or az's message; a label that can't be created commits nothing. Refuses a repository that isn't onboarded, as notEditable says.
 */
export async function openEditPr(input: Record<string, unknown>, run?: Run, dir = boardDataDir()): Promise<{ prUrl: string } | Refused> {
  const { repo, config } = input;
  if (!isRepo(repo) || !isConfigAnswers(config)) return { status: 400, error: "Send the repository and its .lar-factory.json's values." };
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  const labels = config.labels.map((l) => l.trim());
  return writeConfig(repo, run, { title: TITLE, body: BODY }, async () => {
    const content = onboardingConfigFile({ ...config, role: config.role.trim(), labels });
    if (onAzure(repo)) return content;
    let present;
    try { present = await listLabels(repo, run); }
    catch (err) { return { status: 502, error: `Can't read ${repo}'s .lar-factory.json, labels and Edit branch: ${message(err)}` }; }
    for (const name of missingCustomLabels(present, labels)) {
      try { await createLabel(repo, { name }, run); }
      catch (err) { return { status: 502, error: `Couldn't create ${name} in ${repo}: ${message(err)}` }; }
    }
    return content;
  });
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
