// Onboarding's optional PR, opened only for the repository edits the user chose and approved, without touching any
// checkout: factory files dropped, .lar-factory.json or the factory's agent guidance added, and Clash fixes. Onboarding
// finishes without it, and the board doesn't follow it. Its one commit is made on the default branch's head; on GitHub
// the Git data API makes it and gh pr create opens the PR, on Azure Repos one az push makes it with its branch and az
// repos pr create opens the PR. The branch is lar-factory/onboarding; when that is taken, its open PR is reused with
// the branch moved to the new commit and the PR's body replaced, and with none the first free lar-factory/onboarding-N
// is used.

import {
  CONFIG_VERSION, FACTORY_FILES, isRecord, isSkillName, onAzure, type Clash, type FactoryFileKind, type OnboardingPicks, type OnboardingPrChange,
  type SkillPick,
} from '@lar-factory/shared';
import { isRepo } from '../config/repository-config.ts';
import { sharedDefaultsOf } from '../config/repository-settings.ts';
import { createBranch, createCommit, createTree, message, moveBranch } from '../github/github.ts';
import type { Refused } from '../config/edit-config.ts';
import { prHost as host } from '../config/pr-host.ts';
import { bundledSkillNames } from '../skills/bundled-skills.ts';
import { planPrChanges, type PlannedEdits, type PrPlan } from './pr-changes.ts';

const ONBOARDING_BRANCH = 'lar-factory/onboarding';
const TITLE = 'chore: update Lar Factory files';

type Run = (args: string[]) => Promise<string>;

/** A line of the PR body that says what one change does. */
function describe(change: OnboardingPrChange): string {
  switch (change.kind) {
    case 'agent-skills': return `${change.removed ? 'Removes' : 'Writes'} Lar Factory's \`## Agent skills\` block in \`${change.path}\`.`;
    case 'write': return change.path === '.lar-factory.json'
      ? `${change.created ? 'Adds' : 'Replaces'} \`.lar-factory.json\`, the Repository config Lar Factory reads for this repository.`
      : `${change.created ? 'Adds' : 'Replaces'} \`${change.path}\`.`;
    case 'edit': return `Edits \`${change.path}\` at line ${change.line}: ${change.reason}`;
    case 'delete': return `Deletes \`${change.path}\`.`;
    case 'rename': return `Renames \`${change.path}\` to \`${change.to}\`.`;
  }
}

const prBody = (changes: OnboardingPrChange[]) =>
  `This PR:\n\n${changes.map((change) => `- ${describe(change)}`).join('\n')}\n\n`
  + 'Lar Factory onboarding showed these changes with their current and proposed contents, and they were approved before it opened this PR.';

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

/**
 * The body's repository, its edits with any .lar-factory.json added as its text, and its Clash picks, none when it
 * sends none; null when they don't fit.
 */
function readAnswers({ repo, edits, picks = { clashes: [], skills: {} } }: Record<string, unknown>): { repo: string; edits: PlannedEdits; picks: OnboardingPicks } | null {
  if (!isRepo(repo) || !isRecord(edits) || !isPicks(picks) || edits.guidance !== undefined && typeof edits.guidance !== 'boolean') return null;
  const { drop, config } = edits;
  if (!Array.isArray(drop) || !drop.every((kind) => FACTORY_FILES.includes(kind as FactoryFileKind))) return null;
  const shared = config === undefined ? null : isRecord(config) ? sharedDefaultsOf(config, onAzure(repo)) : { problem: 'not an object' };
  if (shared && 'problem' in shared) return null;
  const text = shared && `${JSON.stringify({ version: CONFIG_VERSION, ...shared.defaults }, null, 2)}\n`;
  return { repo, edits: { drop: drop as FactoryFileKind[], config: text, guidance: edits.guidance === true }, picks };
}

/** The PR's changes against the default branch's `head`, or why they can't be made: a pick or edit that no longer fits, or a bundle whose skills can't be read. */
async function plan(repo: string, head: string, edits: PlannedEdits, picks: OnboardingPicks, run?: Run): Promise<PrPlan | Refused> {
  let bundled;
  try { bundled = bundledSkillNames(); }
  catch (err) { return { status: 500, error: `Can't read the app's bundled skills: ${message(err)}` }; }
  const { commitTree, readBlob } = host(repo);
  const tree = await commitTree(repo, head, run);
  const planned = await planPrChanges(tree, (sha) => readBlob(repo, sha, run), edits, picks, bundled, onAzure(repo) ? 'Azure DevOps' : 'GitHub');
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

const ANSWERS = 'Send the repository, the factory files to drop, any additions and Clash picks.';

/** The changes the body's `repo`'s onboarding PR would make with its `edits` and `picks`, or the status and problem. */
export async function previewOnboardingPr(input: Record<string, unknown>, run?: Run): Promise<{ changes: OnboardingPrChange[] } | Refused> {
  const answers = readAnswers(input);
  if (!answers) return { status: 400, error: ANSWERS };
  try {
    const planned = await plan(answers.repo, (await host(answers.repo).defaultBranchHead(answers.repo, run)).sha, answers.edits, answers.picks, run);
    return 'error' in planned ? planned : { changes: planned.changes };
  } catch (err) {
    return { status: 502, error: `Can't read ${answers.repo}'s default branch: ${message(err)}` };
  }
}

/**
 * Opens the PR for the body's `repo` with its `edits` and `picks`, which the user approved, and returns its URL; or
 * the status and problem, with gh's or az's message, when a call or a pick refuses it, or there is nothing to change.
 * A refused pick writes nothing.
 */
export function createPrOpener(run?: Run) {
  const openings = new Map<string, Opening>();
  return async (input: Record<string, unknown>): Promise<{ prUrl: string } | Refused> => {
    const answers = readAnswers(input);
    if (!answers) return { status: 400, error: ANSWERS };
    const { repo, edits, picks } = answers;
    const key = repo.toLowerCase();
    const kept = openings.get(key);
    const answered = JSON.stringify([edits, picks]);
    const opening: Opening = kept?.key === answered ? kept : { key: answered };
    openings.set(key, opening);
    const { createPr, defaultBranchHead, editPrBody, pushCommit } = host(repo);
    const azure = onAzure(repo);
    try {
      opening.head ??= await defaultBranchHead(repo, run);
      if (!opening.plan) {
        const planned = await plan(repo, opening.head.sha, edits, picks, run);
        if ('error' in planned || !planned.changes.length) {
          openings.delete(key);
          return 'error' in planned ? planned : { status: 409, error: `${repo} has no repository edits to open a PR for.` };
        }
        opening.plan = planned;
      }
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
    openings.delete(key);
    return { prUrl: opening.url };
  };
}
