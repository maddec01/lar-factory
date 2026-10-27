// Onboarding's PR, opened on GitHub without touching any checkout. Its one commit, made with the Git data API on the
// default branch's head, holds the factory's agent setup, the .lar-factory.json unless the repository's own is reused,
// and the fixes the Cleanup step picked; gh pr create then opens the PR, whose URL goes in the onboarding's entry. The
// branch is lar-factory/onboarding; when that is taken, its open PR is reused with the branch moved to the new commit,
// and with none the first free lar-factory/onboarding-N is used. Each refresh finishes an onboarding whose PR merged,
// or whose default branch got a .lar-factory.json another way when the PR adds one, closing the PR then, and marks a
// PR closed without merging, which the Pull request step offers to reopen.

import {
  isRecord, isSkillName, onboardingConfigFile, sameRepo, type Clash, type OnboardingPicks, type OnboardingPrChange, type OnboardingRepository, type SkillPick,
} from '@lar-factory/shared';
import {
  type OnboardedRepository, findRepositoryConfig, isConfigAnswers, isProgress, isRepo, readRepositoryList, saveOnboarded, saveOnboarding, savePrClosed,
  stillOnboarding,
} from '../config/repository-config.ts';
import {
  branchExists, closePr, commitTree, createBranch, createCommit, createPr, createTree, defaultBranchHead, editPrBody, message, moveBranch, openPrFrom,
  prState, readBlob, reopenPr,
} from '../github/github.ts';
import { boardDataDir } from '../port/board-record.ts';
import { bundledSkillNames } from '../skills/bundled-skills.ts';
import { planPrChanges, type PrPlan } from './pr-changes.ts';
import { workflowLabelsProblem } from './repository-labels.ts';

const ONBOARDING_BRANCH = 'lar-factory/onboarding';
const TITLE = 'chore: onboard to lar Factory';
const LANDED = '`.lar-factory.json` reached the default branch without this PR, so lar Factory finished onboarding with that file '
  + 'and closed this PR.';

type Run = (args: string[]) => Promise<string>;
type Refused = { status: number; error: string };

/** A line of the PR body that says what one change does. */
function describe(change: OnboardingPrChange): string {
  switch (change.kind) {
    case 'agent-skills': return `Writes lar Factory's \`## Agent skills\` block in \`${change.path}\`.`;
    case 'write': return change.path === '.lar-factory.json'
      ? 'Adds `.lar-factory.json`, the Repository config lar Factory reads for this repository.'
      : `${change.created ? 'Adds' : 'Replaces'} \`${change.path}\`.`;
    case 'edit': return `Edits \`${change.path}\` at line ${change.line}: ${change.reason}`;
    case 'delete': return `Deletes \`${change.path}\`.`;
    case 'rename': return `Renames \`${change.path}\` to \`${change.to}\`.`;
  }
}

const prBody = (changes: OnboardingPrChange[]) =>
  `This PR:\n\n${changes.map((change) => `- ${describe(change)}`).join('\n')}\n\nOnboarding finishes on the board once this PR merges.`;

/**
 * How far opening a repository's PR with one set of answers got, so Retry goes on from the gh call that failed; Retry
 * with other answers or picks starts again, so the PR never carries older ones.
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
  const planned = await planPrChanges(await commitTree(repo, head, run), (sha) => readBlob(repo, sha, run), config, picks, bundled);
  return 'problem' in planned ? { status: 409, error: planned.problem } : planned;
}

const ANSWERS = "Send the repository, its .lar-factory.json's values or null to reuse its own, and the Cleanup step's picks.";

/** The changes the body's `repo`'s onboarding PR would make with its `config` and `picks`, or the status and problem. */
export async function previewOnboardingPr(input: Record<string, unknown>, run?: Run): Promise<{ changes: OnboardingPrChange[] } | Refused> {
  const answers = readAnswers(input);
  if (!answers) return { status: 400, error: ANSWERS };
  try {
    const planned = await plan(answers.repo, (await defaultBranchHead(answers.repo, run)).sha, answers.config, answers.picks, run);
    return 'error' in planned ? planned : { changes: planned.changes };
  } catch (err) {
    return { status: 502, error: `Can't read ${answers.repo}'s default branch: ${message(err)}` };
  }
}

/**
 * Opens the PR for the body's `repo` with its `config`, or null to reuse the repository's own, and its `picks`, once
 * the repository has every workflow label, then keeps the body's `progress` on the Pull request step with the PR's
 * URL, in place of the onboarding saved under `replaces` when it names one. Returns the URL and the repositories still onboarding, or the status and problem, with
 * gh's message, when a call, a pick or the list refuses it; a refused pick writes nothing.
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
      opening.tree ??= await createTree(repo, opening.plan.base, opening.plan.entries, run);
      opening.commit ??= await createCommit(repo, TITLE, opening.tree, opening.head.sha, run);
      const body = prBody(opening.plan.changes);
      if (!opening.branch) {
        const { branch, prUrl } = await onboardingBranch(repo, run);
        if (prUrl) {
          await moveBranch(repo, branch, opening.commit, run);
          await editPrBody(prUrl, body, run);
          opening.url = prUrl;
        } else {
          await createBranch(repo, branch, opening.commit, run);
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
  Promise<{ onboarding: OnboardingRepository[] } | { status: number; error: string }> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository whose onboarding PR to reopen.' };
  let prUrl;
  try { prUrl = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo))?.onboarding?.prUrl; }
  catch (err) { return { status: 409, error: message(err) }; }
  if (!prUrl) return { status: 409, error: `${repo} has no onboarding PR to reopen.` };
  try { await reopenPr(prUrl, run); }
  catch (err) { return { status: 502, error: `Can't reopen ${repo}'s onboarding PR: ${message(err)}` }; }
  try { return { onboarding: stillOnboarding(savePrClosed(repo, false, dir)) }; }
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
        if (state === 'OPEN') await closePr(onboarding.prUrl, LANDED, run);
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
