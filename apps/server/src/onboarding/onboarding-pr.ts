// Onboarding's PR, opened without touching any checkout. Its one commit, made on the default branch's head, holds the
// factory's agent setup, the .lar-factory.json unless the repository's own is reused, and the fixes the Cleanup step
// picked; on GitHub the Git data API makes it and gh pr create opens the PR, on Azure Repos one az push makes it with its
// branch and az repos pr create opens the PR. The PR's URL goes in the onboarding's entry. The branch is
// lar-factory/onboarding; when that is taken, its open PR is reused with the branch moved to the new commit and the
// PR's body replaced, and with none the first free lar-factory/onboarding-N is used. Each refresh finishes an
// onboarding whose PR merged, or whose default branch got a .lar-factory.json another way when the PR adds one, closing
// the PR then, and marks a PR closed without merging, which the Pull request step offers to reopen.
// Reset closes an onboarding's open PR and drops the onboarding from the list; on an onboarded repository it opens the
// reset PR and marks the entry resetting. Each refresh drops a resetting entry once its reset PR merged or closed unmerged.

import {
  isRecord, isSkillName, onAzure, onboardingConfigFile, sameRepo, type Clash, type OnboardingPicks, type OnboardingPrChange, type OnboardingRepository, type SkillPick,
} from '@lar-factory/shared';
import {
  type OnboardedRepository, dropRepository, findRepositoryConfig, isConfigAnswers, isProgress, isRepo, readRepositoryList, saveOnboarded, saveOnboarding,
  savePrClosed, saveResetting, stillOnboarding,
} from '../config/repository-config.ts';
import { createBranch, createCommit, createTree, message, moveBranch } from '../github/github.ts';
import { editPrOf, type Refused } from '../config/edit-config.ts';
import { prHost as host } from '../config/pr-host.ts';
import { boardDataDir } from '../port/board-record.ts';
import { bundledSkillNames } from '../skills/bundled-skills.ts';
import { planPrChanges, type PrPlan } from './pr-changes.ts';
import { keepOnboarding } from './keep-onboarding.ts';
import { openResetPr } from './reset-pr.ts';
import { workflowLabelsProblem } from './repository-labels.ts';

const ONBOARDING_BRANCH = 'lar-factory/onboarding';
const TITLE = 'chore: onboard to lar Factory';
const RESET = 'Reset on the lar Factory board dropped this onboarding, so it closed this PR.';
const RESET_EDIT = 'Reset on the lar Factory board opened a PR that removes `.lar-factory.json`, so it closed this Edit PR.';
const LANDED = '`.lar-factory.json` reached the default branch without this PR, so lar Factory finished onboarding with that file '
  + 'and closed this PR.';

type Run = (args: string[]) => Promise<string>;

/** A line of the PR body that says what one change does. */
function describe(change: OnboardingPrChange): string {
  switch (change.kind) {
    case 'agent-skills': return `Writes lar Factory's \`## Agent skills\` block in \`${change.path}\`.`;
    case 'write': return change.path === '.lar-factory.json'
      ? `${change.created ? 'Adds' : 'Replaces'} \`.lar-factory.json\`, the Repository config lar Factory reads for this repository.`
      : `${change.created ? 'Adds' : 'Replaces'} \`${change.path}\`.`;
    case 'edit': return `Edits \`${change.path}\` at line ${change.line}: ${change.reason}`;
    case 'delete': return `Deletes \`${change.path}\`.`;
    case 'rename': return `Renames \`${change.path}\` to \`${change.to}\`.`;
  }
}

const prBody = (changes: OnboardingPrChange[]) =>
  `This PR:\n\n${changes.map((change) => `- ${describe(change)}`).join('\n')}\n\nOnboarding replaces the agent guides with the factory's provider-specific setup. `
  + 'The board shows current and proposed contents before you open this PR.\n\n'
  + 'Onboarding finishes on the board once this PR merges.';

/**
 * How far opening a repository's PR with one set of answers got, so Retry goes on from the gh or az call that failed;
 * Retry with other answers or picks starts again, so the PR never carries older ones. On Azure Repos the push makes no
 * tree or commit of its own to keep.
 */
interface Opening {
  key: string;
  head?: { branch: string; sha: string };
  plan?: PrPlan;
  tree?: string;
  commit?: string;
  /** The branch the PR comes from, once it points at the commit. */
  branch?: string;
  url?: string;
}

/** The branch onboarding's PR comes from: the first of lar-factory/onboarding, -2, -3 and on that is free, or taken with an open PR to reuse. */
async function onboardingBranch(repo: string, run?: Run): Promise<{ branch: string; prUrl: string | null }> {
  const { branchExists, openPrFrom } = host(repo);
  for (let n = 1; ; n++) {
    const branch = n === 1 ? ONBOARDING_BRANCH : `${ONBOARDING_BRANCH}-${n}`;
    if (!await branchExists(repo, branch, run)) return { branch, prUrl: null };
    const prUrl = await openPrFrom(repo, branch, run);
    if (prUrl) return { branch, prUrl };
  }
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/**
 * Whether the value is a Clash the Cleanup step can tick: a fixed check's delete of CONTEXT.md or .scratch/ or rename of
 * CONTEXT.md to GLOSSARY.md, or an edit of lines, whose file the plan checks.
 */
const isClash = (value: unknown): value is Clash => isRecord(value) && typeof value.file === 'string' && value.file !== ''
  && (value.line === undefined || Number.isInteger(value.line) && (value.line as number) > 0) && typeof value.reason === 'string'
  && isRecord(value.edit) && (value.edit.kind === 'delete' && (value.file === 'CONTEXT.md' || value.file === '.scratch/')
    || value.edit.kind === 'rename' && value.file === 'CONTEXT.md' && value.edit.to === 'GLOSSARY.md'
    || value.edit.kind === 'lines' && value.line !== undefined && strings(value.edit.remove) && strings(value.edit.add));

const isSkillPick = (value: unknown): value is SkillPick => isRecord(value)
  && (value.kind === 'delete' || value.kind === 'rename' && typeof value.name === 'string' && isSkillName(value.name));

const isPicks = (value: unknown): value is OnboardingPicks => isRecord(value) && Array.isArray(value.clashes) && value.clashes.every(isClash)
  && isRecord(value.skills) && Object.entries(value.skills).every(([path, pick]) => path.endsWith('/') && isSkillPick(pick));

/** The body's repository, its .lar-factory.json or null to reuse the repository's own, and its picks; null when they don't fit. */
function readAnswers({ repo, config, picks }: Record<string, unknown>): { repo: string; config: string | null; picks: OnboardingPicks } | null {
  if (!isRepo(repo) || config !== null && !isConfigAnswers(config) || !isPicks(picks)) return null;
  return { repo, config: config && onboardingConfigFile({ ...config, role: config.role.trim() }), picks };
}

/**
 * The PR's changes against the default branch's `head`, or why they can't be made: a pick that no longer fits or that
 * the Cleanup step can't make, no .lar-factory.json to reuse, or a bundle whose skills can't be read.
 */
async function plan(repo: string, head: string, config: string | null, picks: OnboardingPicks, run?: Run): Promise<PrPlan | Refused> {
  if (config === null) {
    const found = await findRepositoryConfig(repo, run);
    if (!found) return { status: 409, error: `${repo} has no .lar-factory.json on its default branch to reuse.` };
    if ('problem' in found) return { status: 409, error: found.problem };
  }
  let bundled;
  try { bundled = bundledSkillNames(); }
  catch (err) { return { status: 500, error: `Can't read the app's bundled skills: ${message(err)}` }; }
  const { commitTree, readBlob } = host(repo);
  const tree = await commitTree(repo, head, run);
  const planned = await planPrChanges(tree, (sha) => readBlob(repo, sha, run), config, picks, bundled, onAzure(repo) ? 'Azure DevOps' : 'GitHub');
  if ('problem' in planned) return { status: 409, error: planned.problem };
  for (const change of planned.changes) {
    if (change.kind !== 'agent-skills' && change.kind !== 'write') continue;
    const entry = planned.entries.find((entry) => entry.path === change.path);
    if (!entry || !('content' in entry)) continue;
    const blob = tree.files.get(change.path);
    change.preview = { before: blob ? await readBlob(repo, blob.sha, run) : null, after: entry.content };
  }
  return planned;
}

const ANSWERS = "Send the repository, its .lar-factory.json's values or null to reuse its own, and the Cleanup step's picks.";

/** The changes the body's `repo`'s onboarding PR would make with its `config` and `picks`, or the status and problem. */
export async function previewOnboardingPr(input: Record<string, unknown>, run?: Run): Promise<{ changes: OnboardingPrChange[] } | Refused> {
  const answers = readAnswers(input);
  if (!answers) return { status: 400, error: ANSWERS };
  try {
    const planned = await plan(answers.repo, (await host(answers.repo).defaultBranchHead(answers.repo, run)).sha, answers.config, answers.picks, run);
    return 'error' in planned ? planned : { changes: planned.changes };
  } catch (err) {
    return { status: 502, error: `Can't read ${answers.repo}'s default branch: ${message(err)}` };
  }
}

/**
 * Opens the PR for the body's `repo` with its `config`, or null to reuse the repository's own, and its `picks`, once
 * the repository has every workflow label, then keeps the body's `progress` on the Pull request step with the PR's
 * URL, in place of the onboarding saved under `replaces` when it names one. Returns the URL and the repositories still onboarding, or the status and problem, with
 * gh's or az's message, when a call, a pick or the list refuses it; a refused pick writes nothing.
 */
export function createPrOpener(dir = boardDataDir(), run?: Run) {
  const openings = new Map<string, Opening>();
  return async (input: Record<string, unknown>): Promise<{ prUrl: string; onboarding: OnboardingRepository[] } | Refused> => {
    const { progress, replaces } = input;
    const answers = readAnswers(input);
    if (!answers || !isProgress(progress) || replaces !== undefined && typeof replaces !== 'string') return { status: 400, error: ANSWERS };
    const { repo, config, picks } = answers;
    const missing = await workflowLabelsProblem(repo, run);
    if (missing) return missing;
    const key = repo.toLowerCase();
    const kept = openings.get(key);
    const answered = JSON.stringify([config, picks]);
    const opening: Opening = kept?.key === answered ? kept : { key: answered };
    openings.set(key, opening);
    const { createPr, defaultBranchHead, editPrBody, pushCommit } = host(repo);
    const azure = onAzure(repo);
    try {
      opening.head ??= await defaultBranchHead(repo, run);
      if (!opening.plan) {
        const planned = await plan(repo, opening.head.sha, config, picks, run);
        if ('error' in planned) {
          openings.delete(key);
          return planned;
        }
        opening.plan = planned;
      }
      const keptProgress = await keepOnboarding({ repo, progress, replaces }, dir, run);
      if ('error' in keptProgress) return keptProgress;
      if (!azure) {
        opening.tree ??= await createTree(repo, opening.plan.base, opening.plan.entries, run);
        opening.commit ??= await createCommit(repo, TITLE, opening.tree, opening.head.sha, run);
      }
      const body = prBody(opening.plan.changes);
      if (!opening.branch) {
        const { branch, prUrl } = await onboardingBranch(repo, run);
        // On Azure Repos one push makes the commit and makes or moves the branch.
        if (azure) await pushCommit(repo, branch, { message: TITLE, parent: opening.head.sha, entries: opening.plan.entries }, run);
        if (prUrl) {
          if (!azure) await moveBranch(repo, branch, opening.commit!, run);
          await editPrBody(prUrl, body, run);
          opening.url = prUrl;
        } else if (!azure) {
          await createBranch(repo, branch, opening.commit!, run);
        }
        opening.branch = branch;
      }
      opening.url ??= await createPr(repo, { base: opening.head.branch, head: opening.branch, title: TITLE, body }, run);
    } catch (err) {
      return { status: 502, error: `Can't open ${repo}'s onboarding PR: ${message(err)}` };
    }
    const done = [...new Set([...progress.done, progress.step])].filter((step) => step !== 'pr');
    try {
      const list = saveOnboarding({ repo, progress: { ...progress, step: 'pr', done, prUrl: opening.url } }, replaces ?? null, dir,
        { reusesConfig: config === null });
      openings.delete(key);
      return { prUrl: opening.url, onboarding: stillOnboarding(list) };
    } catch (err) {
      return { status: 409, error: message(err) };
    }
  };
}

/**
 * Reopens the PR of the body's `repo`'s onboarding, which closed without merging, and returns the repositories still
 * onboarding; or the status and problem, with gh's message, when the body, the list or gh refuses it.
 */
export async function reopenOnboardingPr(input: Record<string, unknown>, dir = boardDataDir(), run?: Run):
  Promise<{ onboarding: OnboardingRepository[] } | Refused> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository whose onboarding PR to reopen.' };
  let prUrl;
  try { prUrl = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo))?.onboarding?.prUrl; }
  catch (err) { return { status: 409, error: message(err) }; }
  if (!prUrl) return { status: 409, error: `${repo} has no onboarding PR to reopen.` };
  try { await host(repo).reopenPr(prUrl, run); }
  catch (err) { return { status: 502, error: `Can't reopen ${repo}'s onboarding PR: ${message(err)}` }; }
  try { return { onboarding: stillOnboarding(savePrClosed(repo, false, dir)) }; }
  catch (err) { return { status: 409, error: message(err) }; }
}

/**
 * Reset of the body's `repo`, returning the repositories still onboarding, and the reset PR's URL when it opens one.
 * While it is still onboarding, Reset closes its onboarding PR with a comment while the PR is open, then drops its
 * entry, opening no PR. Once it is onboarded, Reset closes its open Edit PR with a comment, so that PR can't bring .lar-factory.json back, then opens the reset PR
 * and marks its entry resetting with the PR's URL. Refuses a repository off the list or resetting already, and one
 * whose onboarding PR merged, and keeps the entry, with gh's or az's message, when the call can't read or close the
 * onboarding PR or the Edit PR, or open the reset PR, then saying that the Edit PR it closed is closed now, with `editPrClosed`.
 */
export async function resetRepository(input: Record<string, unknown>, dir = boardDataDir(), run?: Run):
  Promise<{ onboarding: OnboardingRepository[]; prUrl?: string } | (Refused & { editPrClosed?: true })> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository to reset.' };
  let entry;
  try { entry = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo)); }
  catch (err) { return { status: 409, error: message(err) }; }
  if (!entry) return { status: 409, error: `${repo} is not on this Mac's list.` };
  if (entry.resetting) return { status: 409, error: `${repo} is resetting already.` };
  const { closePr, prState } = host(entry.repo);
  if (!entry.onboarding) {
    let editPr;
    try {
      editPr = await editPrOf(entry.repo, run);
      if (editPr) await closePr(editPr, RESET_EDIT, run);
    } catch (err) {
      return { status: 502, error: `Can't close ${repo}'s Edit PR: ${message(err)}` };
    }
    let prUrl;
    try { prUrl = await openResetPr(entry.repo, run); }
    catch (err) {
      const problem = `Can't open ${repo}'s reset PR: ${message(err)}`;
      if (!editPr) return { status: 502, error: problem };
      return { status: 502, error: `${problem.replace(/\.$/, '')}. Its Edit PR, ${editPr}, is closed now.`, editPrClosed: true };
    }
    try { return { onboarding: stillOnboarding(saveResetting(repo, prUrl, dir)), prUrl }; }
    catch (err) { return { status: 409, error: `Opened ${repo}'s reset PR, ${prUrl}, but can't mark it resetting: ${message(err)}` }; }
  }
  const { prUrl } = entry.onboarding;
  if (prUrl) {
    try {
      const state = await prState(prUrl, run);
      if (state === 'MERGED') return { status: 409, error: `${repo}'s onboarding PR merged, so the board finishes its onboarding on its next refresh.` };
      if (state === 'OPEN') await closePr(prUrl, RESET, run);
    } catch (err) {
      return { status: 502, error: `Can't close ${repo}'s onboarding PR: ${message(err)}` };
    }
  }
  try { return { onboarding: stillOnboarding(dropRepository(repo, dir)) }; }
  catch (err) { return { status: 409, error: message(err) }; }
}

/**
 * Follows each onboarding PR in `list` and returns the list as the file has it then, with any save made meanwhile. An onboarding finishes once its PR merged, or,
 * when its PR adds a .lar-factory.json, once its default branch has one the board can read, which came another way; an open PR is then
 * closed with a comment that says why. A PR closed without merging is marked closed, and the mark goes once it is open
 * again. A PR or file that can't be read, or a PR that can't be closed, leaves its onboarding as it is, and `failed`
 * hears why. `finished` hears each repository whose onboarding finishes.
 */
export async function followOnboardingPrs(list: OnboardedRepository[], dir = boardDataDir(), run?: Run, { failed = () => {}, finished = () => {} }: {
  failed?: (repo: string, problem: string) => void; finished?: (repo: string) => void } = {}): Promise<OnboardedRepository[]> {
  const followed = list.filter((e) => e.onboarding?.prUrl);
  for (const { repo, onboarding } of followed) {
    if (!onboarding?.prUrl) continue;
    const { closePr, prState } = host(repo);
    try {
      const state = await prState(onboarding.prUrl, run);
      if (state === 'MERGED') {
        saveOnboarded(repo, null, dir);
        finished(repo);
        continue;
      }
      // A PR that keeps the repository's own file finishes only by merging.
      const found = !onboarding.reusesConfig && await findRepositoryConfig(repo, run);
      if (found && !('problem' in found)) {
        if (state === 'OPEN') {
          try { await closePr(onboarding.prUrl, LANDED, run); }
          catch (err) {
            // The config can land after the state read because this PR just merged.
            const latest = await prState(onboarding.prUrl, run).catch(() => null);
            if (latest !== 'MERGED') throw err;
          }
        }
        saveOnboarded(repo, null, dir);
        finished(repo);
      } else if ((state === 'CLOSED') !== !!onboarding.prClosed) {
        savePrClosed(repo, state === 'CLOSED', dir);
      }
    } catch (err) {
      failed(repo, message(err));
    }
  }
  return followed.length ? readRepositoryList(dir) : list;
}

/**
 * Follows each reset PR in `list` and returns the list as the file has it then. A repository whose reset PR merged, or
 * closed without merging, is dropped from the list, and `dropped` hears it; an open PR leaves the entry resetting. A PR
 * that can't be read leaves its entry as it is, and `failed` hears why.
 */
export async function followResetPrs(list: OnboardedRepository[], dir = boardDataDir(), run?: Run, { failed = () => {}, dropped = () => {} }: {
  failed?: (repo: string, problem: string) => void; dropped?: (repo: string) => void } = {}): Promise<OnboardedRepository[]> {
  const followed = list.flatMap(({ repo, resetting }) => resetting ? [{ repo, prUrl: resetting.prUrl }] : []);
  for (const { repo, prUrl } of followed) {
    try {
      if (await host(repo).prState(prUrl, run) === 'OPEN') continue;
      dropRepository(repo, dir);
      dropped(repo);
    } catch (err) {
      failed(repo, message(err));
    }
  }
  return followed.length ? readRepositoryList(dir) : list;
}
