// The onboarding run the dialog shows: its step, the steps it has passed, the T3 project it picked and the answers it
// has given, with T3's projects as the server lists them and the folder Create a new T3 project adds. Closing before a
// project is picked, or an offered run before Next or any change, drops the run; closing after keeps its repository on
// this Mac's list as onboarding, with where it stopped, and Resume reopens it there. The Labels step reads the
// repository's labels, creates the missing workflow labels and renames old ones, and holds Next while one is missing;
// it also picks the custom labels the PR's .lar-factory.json lists, creating any typed one. On Azure DevOps it waits for
// build #386 and lets Next through. The Checks step runs the command checks, then the setup checks, and holds Next
// until each passes. The Cleanup step runs the fixed checks for known Clashes and reads the Clash agent's runs, which the
// board keeps going while the dialog is closed, asking again every few seconds while one runs. It keeps the user's ticks
// and skill picks with the run, and holds Next until the latest agent run is done and each project skill named like a
// bundled skill is deleted or renamed. The Pull request step lists what the PR changes, as the board previews it with
// the Cleanup step's picks, opens the PR with those picks, then waits for the board to finish the onboarding once the PR
// merges, whether the PR writes a .lar-factory.json or reuses the repository's own. A PR the board finds closed without
// merging offers Reopen PR, or Start over, which opens a new one.

import { create } from 'zustand';
import {
  SETUP_CHECKS, customLabelProblem, isOnboarding, labelPlan, labelsToCreate, missingCustomLabels, sameRepo, skillRenameProblem, workflowLabelsMissing, type BoardData, type CheckedTool, type Clash, type ClashRun, type CleanupPicks, type FixedClashes, type LabelPlan, type ModelChoice, type ModelGroup, type OnboardingOffer, type OnboardingPicks, type OnboardingPrChange, type OnboardingProgress, type ProjectChoice, type Provider, type RepositoryConfigAnswers, type RepositoryItemSource,
  type SetupAnswers, type SetupCheckId, type SetupCheckResult, type SkillClash, type SkillPick, type ToolChecks,
} from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { showToast } from '../notices/toasts.tsx';
import { answerSetup, setupProblems, suggestedShow, type SetupChange } from './setup-answers.ts';

/** The steps in order. */
export const STEPS = [
  { id: 'project', label: 'T3 project' },
  { id: 'setup', label: 'Provider and item source' },
  { id: 'labels', label: 'Labels' },
  { id: 'checks', label: 'Checks' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'pr', label: 'Pull request' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** Where a kept onboarding stopped, as a phrase: waiting for its PR to merge, its PR closed without merging, or stopped at its step. */
export function stoppedAt({ step, prUrl, prClosed }: OnboardingProgress): string {
  if (prUrl) return prClosed ? 'its PR closed without merging' : 'waiting for its PR to merge';
  return `stopped at ${(STEPS.find((s) => s.id === step) ?? STEPS[0]).label}`;
}

export interface Run {
  step: StepId;
  done: StepId[];
  /** The picked T3 project's id. */
  projectId: string | null;
  /** The picked T3 project's repository. */
  repo: string | null;
  /** The picked T3 project's provider, from its origin's host; null until one is picked. */
  provider: Provider | null;
  /** The repository the run was kept under when it was last closed; null for a run never kept. */
  savedAs: string | null;
  /** The Provider and item source step's answers; null until that step first shows. */
  setup: SetupAnswers | null;
  /** The custom labels the Labels step picked, which the PR's .lar-factory.json lists. */
  customLabels: string[];
  /** The Cleanup step's picks; null until that step first shows. */
  cleanup: CleanupPicks | null;
  /** The onboarding PR, once it is open. */
  prUrl: string | null;
}

export type Projects = { state: 'loading' } | { state: 'loaded'; projects: ProjectChoice[] } | { state: 'failed'; error: string };

/** Create a new T3 project, while it's the T3 project step's choice: the folder to add, and how adding it went. */
export interface Creating {
  folder: string;
  adding: boolean;
  error: string | null;
}

/**
 * Why a T3 project can't be picked, or null when it can. The repository a resumed run was kept under stays pickable;
 * another one still onboarding is resumed from its own Resume.
 */
export function unpickable(project: ProjectChoice, run: Run, data: Pick<BoardData, 'onboarding'> = useBoardStore.getState().data): string | null {
  if (project.onBoard && !(project.repo && run.savedAs && sameRepo(project.repo, run.savedAs))) {
    return isOnboarding(data, project.repo) ? 'It’s onboarding already: close this and press its Resume.' : 'Its repository is on the board already.';
  }
  if (!project.repo) return 'Its folder is no main checkout with a GitHub or Azure DevOps origin.';
  return null;
}

/** The run's picked project, from T3's projects. */
export function pickedProject(run: Run, projects: Projects): ProjectChoice | null {
  return projects.state === 'loaded' ? projects.projects.find((p) => p.id === run.projectId) ?? null : null;
}

/** Whether the setup step asks its questions: a GitHub repository with no .lar-factory.json to reuse. */
export const asksSetup = (project: ProjectChoice): boolean => project.provider === 'GitHub' && project.hasConfig === false;

/** Whether the setup step's answers are whole, as setupProblems says. */
const setupAnswered = (setup: SetupAnswers | null): boolean => !!setup && Object.keys(setupProblems(setup)).length === 0;

/** The item source the run reads: its reused .lar-factory.json's, else its answers'; null until they are whole. */
export function itemSourceOf(run: Run, project: ProjectChoice): RepositoryItemSource | null {
  if (project.config) return project.config.itemSource;
  if (!setupAnswered(run.setup)) return null;
  return run.setup!.itemSource === 'issues' ? { kind: 'issues' } : { kind: 'github-project', owner: run.setup!.projectOwner, number: Number(run.setup!.projectNumber) };
}

/** The .lar-factory.json values the onboarding PR writes, from the setup step's answers; null until they are whole. */
export function configOf(run: Run, project: ProjectChoice): RepositoryConfigAnswers | null {
  const itemSource = itemSourceOf(run, project);
  return itemSource && run.setup && { itemSource, show: run.setup.show, role: run.setup.role.trim(), labels: run.customLabels };
}

/** Whether the run's onboarding finished: its PR is open and the board no longer has its repository onboarding, as the PR merged. */
export const onboarded = (run: Run, data: Pick<BoardData, 'onboarding'>): boolean => !!run.prUrl && !isOnboarding(data, run.repo);

/** Whether the board found the run's PR closed without merging. */
export function prClosed(run: Run, data: Pick<BoardData, 'onboarding'>): boolean {
  const kept = run.repo ? data.onboarding?.find((o) => sameRepo(o.repo, run.repo!)) : undefined;
  return !!run.prUrl && kept?.progress.prUrl === run.prUrl && !!kept.progress.prClosed;
}

/** The commands the Checks step checks for a GitHub repository; az waits for Azure DevOps in build #386. */
export const COMMAND_CHECKS = ['gh', 't3', 'git', 'jq', 'curl'] as const satisfies readonly CheckedTool[];

/** Whether a command's check passes for the item source; gh needs the project scope only to read a GitHub Project. */
export function commandPasses(name: (typeof COMMAND_CHECKS)[number], tools: ToolChecks | undefined, source: RepositoryItemSource | null): boolean {
  const check = tools?.[name];
  return check?.result === 'ok' || check?.result === 'no-project-scope' && source?.kind === 'issues' && !check.upgrade;
}

/** A setup check on the Checks step: waiting for the checks before it, running, or done with its result. */
type SetupCheckState = { state: 'waiting' } | { state: 'running' } | { state: 'done'; result: SetupCheckResult };

/** The Checks step's checks. */
export interface Checks {
  /** The command checks, which the board runs again; once done, their results are the board's tools. */
  commands: { state: 'running' } | { state: 'done' } | { state: 'failed'; error: string };
  setup: Record<SetupCheckId, SetupCheckState>;
}

/** Whether every check on the Checks step passed. */
export function checksPassed(checks: Checks | null, tools: ToolChecks | undefined, source: RepositoryItemSource | null): boolean {
  return checks?.commands.state === 'done' && COMMAND_CHECKS.every((name) => commandPasses(name, tools, source))
    && SETUP_CHECKS.every((id) => { const c = checks.setup[id]; return c.state === 'done' && c.result.passed; });
}

/**
 * The Cleanup step's fixed checks: running, or read with the bundled skill names the board had then, or the board's
 * problem.
 */
export type Clashes = { state: 'reading' } | { state: 'read'; found: FixedClashes; bundled: string[] } | { state: 'failed'; error: string };

/** Whether a Clash's edit goes in the PR: never when it won't apply, else the user's tick, else as the check offers it. */
export const ticked = (clash: Clash, picks: CleanupPicks | null): boolean => !clash.wontApply && (picks?.ticks[clash.id] ?? clash.ticked);

/** The folder that holds a skill's folder, such as `.claude/skills/`. */
export const skillsDir = (path: string) => path.replace(/[^/]+\/$/, '');

/**
 * What Next waits for from a skill Clash, or null once it's picked: Delete, or Rename to a valid name that no bundled
 * skill, no other project skill, and no other rename into the same folder has.
 */
export function skillProblem(skill: SkillClash, picks: CleanupPicks | null, clashes: Extract<Clashes, { state: 'read' }>): string | null {
  const pick = picks?.skills[skill.path];
  if (!pick) return 'Next needs Delete it in the PR, or Rename it.';
  if (pick.kind === 'delete') return null;
  const renamedBeside = clashes.found.skillClashes.flatMap((other) => {
    const picked = picks.skills[other.path];
    return other.path !== skill.path && skillsDir(other.path) === skillsDir(skill.path) && picked?.kind === 'rename' ? [picked.name] : [];
  });
  return skillRenameProblem(pick.name, clashes.bundled, clashes.found.projectSkills, renamedBeside);
}

/**
 * The Cleanup step's Clash agent: its runs as the board last answered, oldest first, null until it first answers; the
 * model picked for the next run, null while none is; whether Look for Clashes or Retry is posting; and the board's
 * problem with the last post or read, with which call failed, so Retry makes it again.
 */
export interface Agent {
  runs: ClashRun[] | null;
  model: ModelChoice | null;
  starting: boolean;
  error: { call: 'start' | 'read'; message: string } | null;
}

const NO_AGENT: Agent = { runs: null, model: null, starting: false, error: null };

/** The agent's latest run, which the step shows and Next waits for; null before the first. */
export const latestRun = (agent: Agent | null): ClashRun | null => agent?.runs?.at(-1) ?? null;

/** The model the next run starts on: the one picked, else the latest run's, else the first T3 offers. */
export const nextModel = (agent: Agent | null, groups: readonly ModelGroup[]): ModelChoice | null => {
  if (agent?.model) return agent.model;
  const latest = latestRun(agent);
  if (latest) return latest.model;
  const first = groups.find((g) => g.models.length);
  return first ? { instanceId: first.instanceId, model: first.models[0]!.slug } : null;
};

/** Whether the fixed checks ran, the latest agent run is done and each skill Clash is picked. */
const cleanupDone = (run: Run, clashes: Clashes | null, agent: Agent | null): boolean =>
  clashes?.state === 'read' && latestRun(agent)?.state === 'done' && clashes.found.skillClashes.every((skill) => !skillProblem(skill, run.cleanup, clashes));

/**
 * The fixes the PR holds, from the Cleanup step: the fixed checks' and the latest agent run's ticked Clashes, and each
 * skill Clash's pick. Null until the fixed checks are read and the latest agent run is done.
 */
export function picksOf(run: Run, clashes: Clashes | null, agent: Agent | null): OnboardingPicks | null {
  const latest = latestRun(agent);
  if (clashes?.state !== 'read' || latest?.state !== 'done') return null;
  const skills = Object.fromEntries(clashes.found.skillClashes.flatMap((skill) => {
    const pick = run.cleanup?.skills[skill.path];
    return pick ? [[skill.path, pick]] : [];
  }));
  return { clashes: [...clashes.found.clashes, ...latest.clashes].filter((clash) => ticked(clash, run.cleanup)), skills };
}

/** The .lar-factory.json values the PR writes, null when it reuses the repository's own; undefined until the setup step's answers are whole. */
function prConfig(run: Run, project: ProjectChoice): RepositoryConfigAnswers | null | undefined {
  return project.config ? null : configOf(run, project) ?? undefined;
}

/** The Pull request step's list of the PR's changes, as the board previews them, or the board's problem. */
type PrChanges = { state: 'reading' } | { state: 'read'; changes: OnboardingPrChange[] } | { state: 'failed'; error: string };

/** A change the Labels step makes: Create, Rename, or adding a typed custom label. */
type LabelAction = 'create' | 'rename' | 'custom';

/**
 * The Labels step's read of the repository's labels, the old names Rename leaves, the custom label being typed, and a
 * change while it runs or once it failed.
 */
export interface Labels {
  read: { state: 'loading' } | { state: 'loaded'; names: string[] } | { state: 'failed'; error: string };
  /** The old names unticked for Rename, whose new labels Create makes instead. */
  kept: string[];
  /** The new custom label's field. */
  typed: string;
  /** The custom labels the step created on the repository, which it doesn't list as left alone. */
  created: string[];
  busy: LabelAction | null;
  /** A change that failed, with the custom label it was adding for a typed one. */
  error: { action: LabelAction; message: string; name?: string } | null;
}

/** The Labels step's plan for the run's repository once its labels are read; null before. */
export function labelsPlan(run: Run, project: ProjectChoice, labels: Labels | null): LabelPlan | null {
  return labels?.read.state === 'loaded' ? labelPlan(labels.read.names, itemSourceOf(run, project)?.kind ?? 'github-project') : null;
}

/** The custom labels a reused .lar-factory.json lists that the repository lacks, which Create makes too; none for a run that picks its own. */
export const customLabelsToCreate = (project: ProjectChoice, labels: Labels): string[] =>
  project.config && labels.read.state === 'loaded' ? missingCustomLabels(labels.read.names, project.config.labels) : [];

/** The old names Rename moves: each the plan offers, less those unticked. */
export const renaming = (plan: LabelPlan, labels: Labels): string[] =>
  plan.workflow.flatMap((r) => r.state === 'rename' && !labels.kept.includes(r.oldName) ? [r.oldName] : []);

/** Whether the run's step lets Next move past it. */
export function stepReady(run: Run, projects: Projects, checks: Checks | null = null, tools?: ToolChecks, clashes: Clashes | null = null,
  agent: Agent | null = null, labels: Labels | null = null): boolean {
  const project = pickedProject(run, projects);
  if (!project) return false;
  if (run.step === 'project') return true;
  if (run.step === 'setup') return !!project.config || asksSetup(project) && setupAnswered(run.setup);
  if (run.step === 'labels') {
    if (project.provider === 'Azure DevOps') return true;
    const plan = labelsPlan(run, project, labels);
    return !!plan && !workflowLabelsMissing(plan);
  }
  if (run.step === 'checks') return checksPassed(checks, tools, itemSourceOf(run, project));
  if (run.step === 'cleanup') return cleanupDone(run, clashes, agent);
  return false;
}

interface WizardState {
  /** The run the dialog shows; null while it's closed. */
  run: Run | null;
  projects: Projects;
  /** Create a new T3 project's form; null while a listed project is the choice. */
  creating: Creating | null;
  /** The Labels step's labels; null until the run reaches it. */
  labels: Labels | null;
  /** The Checks step's checks; null until the run first reaches it. */
  checks: Checks | null;
  /** The Cleanup step's fixed checks; null until the run first reaches it. */
  clashes: Clashes | null;
  /** The Cleanup step's Clash agent. */
  agent: Agent;
  /** The Pull request step's list of the PR's changes; null until the run first reaches it. */
  changes: PrChanges | null;
  /** The button that opened the dialog, which gets focus back when it closes. */
  opener: HTMLElement | null;
  /** Opens a new run, with the offered T3 project picked when it comes from an offer. */
  start: (offer?: OnboardingOffer) => void;
  /** Reopens the onboarding the board keeps for `repo`, on its step with its answers. */
  resume: (repo: string) => void;
  close: () => void;
  /** Reads T3's projects again. */
  loadProjects: () => Promise<void>;
  pick: (projectId: string) => void;
  /** Chooses Create a new T3 project, which unpicks the picked project. */
  chooseNew: () => void;
  setFolder: (folder: string) => void;
  /** Adds the form's folder as a T3 project and picks it. */
  createProject: () => Promise<void>;
  /** Changes the setup step's answers. A new item source brings its suggested show setting until one is picked. */
  answer: (change: SetupChange) => void;
  next: () => void;
  back: () => void;
  /** Reads the repository's labels for the Labels step; on Azure DevOps it reads nothing. */
  loadLabels: () => Promise<void>;
  /** Ticks or unticks an old name for Rename. */
  toggleRename: (oldName: string) => void;
  /** Creates the missing labels, less the old names Rename moves. */
  createLabels: () => Promise<void>;
  /** Renames each ticked old name to its new one. */
  renameLabels: () => Promise<void>;
  /** Picks or unpicks a custom label. */
  toggleCustomLabel: (name: string) => void;
  /** Changes the new custom label's field. */
  typeCustomLabel: (typed: string) => void;
  /** Creates the typed custom label on the repository, unless it has it already, and picks it. */
  addCustomLabel: () => Promise<void>;
  /** Runs the command checks, then each setup check in turn. */
  runChecks: () => Promise<void>;
  /** Runs one setup check again. */
  retryCheck: (id: SetupCheckId) => Promise<void>;
  /** Runs the fixed checks for known Clashes on the run's repository. */
  findClashes: () => Promise<void>;
  /** Reads the agent's runs for the run's repository, and again every few seconds while the latest runs. */
  readClashRuns: () => Promise<void>;
  /** Picks the model the next agent run starts on. */
  pickModel: (model: ModelChoice) => void;
  /**
   * Look for Clashes, Look again or Retry: starts an agent run in a new T3 thread on `model`, leaving the earlier runs listed. A
   * new run's Clashes reuse the ids of the earlier ones', so their ticks are dropped once the board takes the run; a failed
   * start keeps them.
   */
  lookForClashes: (model: ModelChoice) => Promise<void>;
  /** Ticks or unticks a Clash's edit, by its id. */
  tick: (id: string, on: boolean) => void;
  /** Picks Delete or Rename for a skill Clash, by its path. */
  pickSkill: (path: string, pick: SkillPick) => void;
  /** Asks the board what the PR changes with the run's answers and the Cleanup step's picks. */
  previewPr: () => Promise<void>;
  /**
   * On the Pull request step with no changes read, as after Resume, or with their read failed, as on Retry: runs the
   * fixed checks and reads the agent's runs again for the picks, then asks the board what the PR changes.
   */
  readPrChanges: () => Promise<void>;
  /**
   * Opening or reopening the onboarding PR, and why the board couldn't; Check now while it waits for the board's read,
   * and when that read last answered with the PR still open.
   */
  pr: { opening: boolean; reopening: boolean; checking: boolean; checkedAt: number | null; error: string | null };
  /** Opens the onboarding PR, which the board keeps with the run's progress. */
  openPr: () => Promise<void>;
  /** Reopens the run's PR, which closed without merging. */
  reopenPr: () => Promise<void>;
  /** Drops the run's closed PR and opens a new one. */
  startOver: () => Promise<void>;
  /** Has the board read GitHub now, so it finds a merge before its next refresh, and waits for that read. */
  checkMerge: () => Promise<void>;
}

/** Counts project reads, so one answered after a newer read or a close is dropped. */
let reads = 0;
/** Counts check runs, so a check answered after a newer run or a close is dropped. */
let checkRuns = 0;
/** Counts fixed check runs, so one answered after a newer run or a close is dropped. */
let clashReads = 0;
/** Counts previews of the PR's changes, so one answered after a newer preview or a close is dropped. */
let previews = 0;
/** Counts reads of the agent's runs, so one answered after a newer read, a start or a close is dropped, and its next read with it. */
let agentReads = 0;
/** The next read of the agent's runs while one runs. */
let agentTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts label reads and changes, so one answered after a newer one or a close is dropped. */
let labelRuns = 0;
/** The run an offer opened, until Next or a change replaces it; closing it then keeps nothing. */
let untouchedOffer: Run | null = null;

/** The Cleanup step's picks before any is changed. */
const NO_PICKS: CleanupPicks = { ticks: {}, skills: {} };

const IDLE: WizardState['pr'] = { opening: false, reopening: false, checking: false, checkedAt: null, error: null };

/** How often the step asks for the agent's runs while one runs. */
export const AGENT_POLL_MS = 3_000;

/** Stops reading the agent's runs: the dialog closed, or a newer read or start replaces the one waiting. */
function stopAgentReads(): void {
  agentReads++;
  clearTimeout(agentTimer);
}

/** Drops the ticks of the agent's Clashes, whose ids a new run reuses. */
const withoutAgentTicks = (picks: CleanupPicks): CleanupPicks =>
  ({ ...picks, ticks: Object.fromEntries(Object.entries(picks.ticks).filter(([id]) => !id.startsWith('agent-'))) });

/** How long Check now waits for the board's read before it gives up. */
const READ_WAIT_MS = 60_000;

/**
 * The board data the page gets once the board read GitHub after `before`: a new read time, or a read problem other than
 * the one `before` has. Null when none arrives within READ_WAIT_MS, as when gh can't read at all; `cancel` stops waiting.
 */
function nextRead(before: BoardData): { read: Promise<BoardData | null>; cancel: () => void } {
  let cancel = () => {};
  const read = new Promise<BoardData | null>((resolve) => {
    const done = (data: BoardData | null) => {
      clearTimeout(timer);
      stop();
      resolve(data);
    };
    const stop = useBoardStore.subscribe(({ data }) => {
      if (data.fetchedAt !== before.fetchedAt || data.error && data.error !== before.error) done(data);
    });
    const timer = setTimeout(() => done(null), READ_WAIT_MS);
    cancel = () => done(null);
  });
  return { read, cancel };
}

const WAITING: Record<SetupCheckId, SetupCheckState> = { checkout: { state: 'waiting' }, source: { state: 'waiting' }, push: { state: 'waiting' } };

const isStep = (id: string): id is StepId => STEPS.some((s) => s.id === id);

/** The focused element, as the button that opens the dialog; null when nothing is. */
const focused = (): HTMLElement | null => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

/** The run a kept onboarding resumes; a step this dialog doesn't have, as a newer board's, resumes on the T3 project step. */
function resumed(repo: string, progress: OnboardingProgress): Run {
  return { step: isStep(progress.step) ? progress.step : 'project', done: progress.done.filter(isStep), projectId: progress.answers.projectId, repo,
    provider: progress.answers.provider ?? null, savedAs: repo, setup: progress.answers.setup ?? null, customLabels: progress.answers.customLabels ?? [],
    cleanup: progress.answers.cleanup ?? null,
    prUrl: progress.prUrl ?? null };
}

/** The setup step's answers before any is given: a GitHub Project of the repository's owner, with its suggested show setting. */
const firstSetup = (repo: string | null): SetupAnswers => ({
  itemSource: 'github-project', projectOwner: repo?.split('/')[0] ?? '', projectNumber: '', show: suggestedShow('github-project'), showPicked: false, role: '',
});

/** Where the run stopped, as the board keeps it. */
const progressOf = (run: Run & { projectId: string }): OnboardingProgress => ({ step: run.step, done: run.done,
  answers: { projectId: run.projectId, ...run.provider && { provider: run.provider }, ...run.setup && { setup: run.setup },
    ...run.customLabels.length && { customLabels: run.customLabels }, ...run.cleanup && { cleanup: run.cleanup } },
  ...run.prUrl && { prUrl: run.prUrl } });

/** The onboarding a run kept under another repository replaces, to send with its repository. */
const replacing = (run: Run & { repo: string }) => run.savedAs && !sameRepo(run.savedAs, run.repo) ? { replaces: run.savedAs } : {};

/** Asks the server to keep the run's repository as onboarding; a refusal shows in a toast. */
async function keep(run: Run & { projectId: string; repo: string }): Promise<void> {
  const progress = progressOf(run);
  const replaces = replacing(run);
  const result = await postAction('/api/onboarding/repositories', { repo: run.repo, progress, ...replaces });
  receive(result);
  if (result.error) showToast({ slot: 'onboarding', failed: true, what: ` error for onboarding ${run.repo}`,
    body: `Couldn't keep onboarding ${run.repo} on the board. ${result.error}` });
}

export const useWizardStore = create<WizardState>()((set, get) => {
  const move = (by: 1 | -1) => {
    const { run, projects, checks, clashes, agent, labels } = get();
    // Once its PR is open, the run stays on the Pull request step.
    if (!run || run.prUrl || (by === 1 && !stepReady(run, projects, checks, useBoardStore.getState().data.tools, clashes, agent, labels))) return;
    const to = STEPS[STEPS.findIndex((s) => s.id === run.step) + by]?.id;
    if (to) set({ run: { ...run, step: to, done: by === 1 ? [...new Set([...run.done, run.step])] : run.done,
      setup: run.setup ?? (to === 'setup' ? firstSetup(run.repo) : null), cleanup: run.cleanup ?? (to === 'cleanup' ? NO_PICKS : null) } });
    if (to === 'labels') void get().loadLabels();
    if (to === 'checks') void get().runChecks();
    if (to === 'cleanup') {
      void get().findClashes();
      void get().readClashRuns();
    } else stopAgentReads();
    if (to === 'pr') void get().previewPr();
  };

  /** Shows the agent's runs as the board answered them, and asks again in a while if the latest still runs. */
  const showRuns = (runs: ClashRun[], read: number) => {
    set({ agent: { ...get().agent, runs, error: null } });
    if (runs.at(-1)?.state === 'running') agentTimer = setTimeout(() => { if (read === agentReads) void get().readClashRuns(); }, AGENT_POLL_MS);
  };

  /** The labels while `runId` is the latest label run and the run is open. */
  const currentLabels = (runId: number) => runId === labelRuns && get().run ? get().labels : null;

  /**
   * Posts a label read or change for the run's repository, and keeps its answer while it's the latest; the labels it
   * answers with, if any. A failed change keeps `name`, the custom label it was adding.
   */
  const labelsPost = async (path: string, body: object, action: LabelAction | null, name?: string): Promise<string[] | undefined> => {
    const { run } = get();
    if (!run?.repo) return;
    const runId = ++labelRuns;
    const answer = await postAction<{ labels: string[] }>(path, { repo: run.repo, ...body });
    const now = currentLabels(runId);
    if (!now) return;
    if (answer.labels) {
      set({ labels: { ...now, read: { state: 'loaded', names: answer.labels }, busy: null, error: null } });
      return answer.labels;
    }
    const message = answer.error ?? 'The board sent no labels.';
    if (!action) return void set({ labels: { ...now, read: { state: 'failed', error: message } } });
    set({ labels: { ...now, busy: null, error: { action, message, ...name !== undefined && { name } } } });
    // Some labels may have changed before gh failed, so read them again.
    const reread = await postAction<{ labels: string[] }>('/api/onboarding/labels', { repo: run.repo });
    const after = currentLabels(runId);
    if (after && reread.labels) set({ labels: { ...after, read: { state: 'loaded', names: reread.labels } } });
  };

  /** The run's project and its label plan, while the Labels step has its labels and no change running. */
  const labelStep = () => {
    const { run, projects, labels } = get();
    const project = run && pickedProject(run, projects);
    const plan = run && project && labelsPlan(run, project, labels);
    return run && project && plan && labels && !labels.busy ? { run, project, plan, labels } : null;
  };

  /** The run's checks while `runId` is the latest check run and the run is open. */
  const current = (runId: number) => runId === checkRuns && get().run ? get().checks : null;

  const runSetupCheck = async (id: SetupCheckId, runId: number) => {
    const { run, projects } = get();
    const project = run && pickedProject(run, projects);
    const checks = current(runId);
    if (!run?.repo || !project || !checks) return;
    set({ checks: { ...checks, setup: { ...checks.setup, [id]: { state: 'running' } } } });
    const answer = await postAction<{ result: SetupCheckResult }>('/api/onboarding/checks',
      { check: id, repo: run.repo, projectId: project.id, itemSource: itemSourceOf(run, project) });
    const now = current(runId);
    if (!now) return;
    const result: SetupCheckResult = answer.result ?? { passed: false, problem: answer.error ?? 'The board sent no result.', fix: 'Retry once the board answers.' };
    set({ checks: { ...now, setup: { ...now.setup, [id]: { state: 'done', result } } } });
  };

  return {
    run: null,
    projects: { state: 'loading' },
    creating: null,
    checks: null,
    clashes: null,
    agent: NO_AGENT,
    changes: null,
    labels: null,
    pr: IDLE,
    opener: null,
    start: (offer) => {
      checkRuns++;
      // The board offers only GitHub repositories until build #386.
      clashReads++;
      const run: Run = { step: 'project', done: [], projectId: offer?.projectId ?? null, repo: offer?.repo ?? null, provider: offer ? 'GitHub' : null,
        savedAs: null, setup: null, customLabels: [], cleanup: null, prUrl: null };
      untouchedOffer = offer ? run : null;
      stopAgentReads();
      previews++;
      set({ run, creating: null, checks: null, clashes: null, agent: NO_AGENT, changes: null, labels: null, pr: IDLE, opener: focused() });
      void get().loadProjects();
    },
    resume: (repo) => {
      const kept = useBoardStore.getState().data.onboarding?.find((o) => sameRepo(o.repo, repo));
      if (!kept) return;
      checkRuns++;
      clashReads++;
      stopAgentReads();
      previews++;
      const run = resumed(kept.repo, kept.progress);
      // The labels and the checks read the picked project, so they wait for T3's projects; the fixed checks and agent runs
      // read only the repository. The Pull request step reads them with readPrChanges once it lists the PR's changes.
      set({ run, creating: null, checks: null, clashes: null, agent: NO_AGENT, changes: null, labels: null, pr: IDLE, opener: focused() });
      if (run.step === 'cleanup') {
        void get().findClashes();
        void get().readClashRuns();
      }
      void get().loadProjects().then(() => {
        if (get().run?.step === 'labels') void get().loadLabels();
        if (get().run?.step === 'checks') void get().runChecks();
      });
    },
    close: () => {
      const { run } = get();
      reads++;
      checkRuns++;
      clashReads++;
      previews++;
      labelRuns++;
      // The board keeps the agent's run going; Resume reads it again.
      stopAgentReads();
      set({ run: null, checks: null, clashes: null, agent: NO_AGENT, changes: null, labels: null });
      // A run whose PR merged is onboarded, so there's no onboarding left to keep.
      if (run?.projectId && run.repo && run !== untouchedOffer && !onboarded(run, useBoardStore.getState().data)) {
        void keep({ ...run, projectId: run.projectId, repo: run.repo });
      }
    },
    loadProjects: async () => {
      const read = ++reads;
      set({ projects: { state: 'loading' } });
      let projects: Projects;
      try {
        const response = await fetch('/api/onboarding/projects', { cache: 'no-store' });
        const body = await response.json() as { projects?: ProjectChoice[]; error?: string };
        projects = body.projects ? { state: 'loaded', projects: body.projects } : { state: 'failed', error: body.error ?? `The board answered ${response.status}.` };
      } catch {
        projects = { state: 'failed', error: "Can't reach the board." };
      }
      if (read === reads) set({ projects });
    },
    pick: (projectId) => {
      const { run, projects } = get();
      const project = projects.state === 'loaded' ? projects.projects.find((p) => p.id === projectId) : undefined;
      if (run && project && !unpickable(project, run)) set({ run: { ...run, projectId, repo: project.repo, provider: project.provider }, creating: null });
    },
    chooseNew: () => {
      const { run, creating } = get();
      if (run) set({ run: { ...run, projectId: null, repo: null, provider: null }, creating: creating ?? { folder: '', adding: false, error: null } });
    },
    setFolder: (folder) => {
      const { creating } = get();
      if (creating) set({ creating: { ...creating, folder } });
    },
    createProject: async () => {
      const { creating } = get();
      if (!creating || creating.adding) return;
      set({ creating: { ...creating, adding: true, error: null } });
      const result = await postAction<{ projects: ProjectChoice[]; projectId: string }>('/api/onboarding/projects', { folder: creating.folder });
      const { run, creating: now } = get();
      // The run closed, or the step chose a listed project, while t3 ran.
      if (!run || !now) return;
      if (result.error || !result.projects || !result.projectId) return set({ creating: { ...now, adding: false, error: result.error ?? 'The board sent no project.' } });
      reads++;
      set({ projects: { state: 'loaded', projects: result.projects } });
      const added = result.projects.find((p) => p.id === result.projectId);
      const reason = added ? unpickable(added, run) : 'T3 Code doesn’t list it.';
      if (reason) return set({ creating: { ...now, adding: false, error: `T3 Code added the project, but it can't be picked: ${reason}` } });
      get().pick(result.projectId);
    },
    answer: (change) => {
      const { run } = get();
      if (!run?.setup) return;
      set({ run: { ...run, setup: answerSetup(run.setup, change) } });
    },
    next: () => move(1),
    back: () => move(-1),
    loadLabels: async () => {
      const { run, projects } = get();
      const project = run && pickedProject(run, projects);
      if (!project || project.provider === 'Azure DevOps') return;
      set({ labels: { read: { state: 'loading' }, kept: get().labels?.kept ?? [], typed: get().labels?.typed ?? '', created: get().labels?.created ?? [], busy: null, error: null } });
      await labelsPost('/api/onboarding/labels', {}, null);
    },
    toggleRename: (oldName) => {
      const { labels } = get();
      if (labels) set({ labels: { ...labels, kept: labels.kept.includes(oldName) ? labels.kept.filter((n) => n !== oldName) : [...labels.kept, oldName] } });
    },
    createLabels: async () => {
      const step = labelStep();
      const custom = step ? customLabelsToCreate(step.project, step.labels) : [];
      if (!step || !labelsToCreate(step.plan, renaming(step.plan, step.labels)).length && !custom.length) return;
      set({ labels: { ...step.labels, busy: 'create', error: null } });
      await labelsPost('/api/onboarding/labels/create', { itemSource: itemSourceOf(step.run, step.project), renaming: renaming(step.plan, step.labels), custom }, 'create');
    },
    renameLabels: async () => {
      const step = labelStep();
      const names = step ? renaming(step.plan, step.labels) : [];
      if (!step || !names.length) return;
      set({ labels: { ...step.labels, busy: 'rename', error: null } });
      await labelsPost('/api/onboarding/labels/rename', { names }, 'rename');
    },
    toggleCustomLabel: (name) => {
      const { run } = get();
      if (run) set({ run: { ...run, customLabels: run.customLabels.includes(name) ? run.customLabels.filter((n) => n !== name) : [...run.customLabels, name] } });
    },
    typeCustomLabel: (typed) => {
      const { labels } = get();
      // Typing clears a failed add, whose title names the label it was adding.
      if (labels) set({ labels: { ...labels, typed, ...labels.error?.action === 'custom' && { error: null } } });
    },
    addCustomLabel: async () => {
      const step = labelStep();
      if (!step || customLabelProblem(step.labels.typed)) return;
      const name = step.labels.typed.trim();
      set({ labels: { ...step.labels, busy: 'custom', error: null } });
      const names = await labelsPost('/api/onboarding/labels/custom', { name }, 'custom', name);
      const { run, labels } = get();
      // The repository's own spelling, as GitHub matches label names without case.
      const added = names?.find((n) => n.toLowerCase() === name.toLowerCase());
      if (!run || !labels || !added) return;
      set({ run: { ...run, customLabels: run.customLabels.includes(added) ? run.customLabels : [...run.customLabels, added] }, labels: { ...labels, typed: '', created: [...labels.created, added] } });
    },
    runChecks: async () => {
      const runId = ++checkRuns;
      set({ checks: { commands: { state: 'running' }, setup: WAITING } });
      const rechecked = await postAction('/api/recheck', {});
      receive(rechecked);
      const checks = current(runId);
      if (!checks) return;
      set({ checks: { ...checks, commands: rechecked.error ? { state: 'failed', error: rechecked.error } : { state: 'done' } } });
      for (const id of SETUP_CHECKS) await runSetupCheck(id, runId);
    },
    retryCheck: (id) => runSetupCheck(id, checkRuns),
    findClashes: async () => {
      const { run } = get();
      if (!run?.repo) return;
      const read = ++clashReads;
      set({ clashes: { state: 'reading' } });
      const answer = await postAction<FixedClashes>('/api/onboarding/clashes', { repo: run.repo });
      if (read !== clashReads || !get().run) return;
      const { clashes, skillClashes, projectSkills } = answer;
      if (answer.error || !clashes || !skillClashes || !projectSkills) return set({ clashes: { state: 'failed', error: answer.error ?? 'The board sent no Clashes.' } });
      // A checklist, `references/<file>`, is no skill.
      const bundled = (useBoardStore.getState().data.bundledSkills ?? []).map((skill) => skill.name).filter((name) => !name.includes('/'));
      set({ clashes: { state: 'read', found: { clashes, skillClashes, projectSkills }, bundled } });
    },
    readClashRuns: async () => {
      const { run } = get();
      if (!run?.repo) return;
      stopAgentReads();
      const read = agentReads;
      let answer: { runs?: ClashRun[]; error?: string | null };
      try {
        const response = await fetch(`/api/onboarding/clash-runs?repo=${encodeURIComponent(run.repo)}`, { cache: 'no-store' });
        answer = await response.json() as typeof answer;
        if (!answer.runs && !answer.error) answer.error = `The board answered ${response.status}.`;
      } catch {
        answer = { error: "Can't reach the board." };
      }
      if (read !== agentReads || !get().run) return;
      if (answer.runs) return showRuns(answer.runs, read);
      set({ agent: { ...get().agent, error: { call: 'read', message: answer.error! } } });
    },
    pickModel: (model) => set({ agent: { ...get().agent, model } }),
    lookForClashes: async (model) => {
      const { run, agent } = get();
      if (!run?.repo || !run.projectId || agent.starting || latestRun(agent)?.state === 'running') return;
      stopAgentReads();
      const read = agentReads;
      set({ agent: { ...agent, starting: true, error: null } });
      const answer = await postAction<{ runs: ClashRun[] }>('/api/onboarding/clash-runs', { repo: run.repo, projectId: run.projectId, model });
      const now = get().run;
      if (read !== agentReads || !now) return;
      set({ agent: { ...get().agent, starting: false } });
      if (answer.error || !answer.runs) return set({ agent: { ...get().agent, error: { call: 'start', message: answer.error ?? 'The board sent no run.' } } });
      if (now.cleanup) set({ run: { ...now, cleanup: withoutAgentTicks(now.cleanup) } });
      showRuns(answer.runs, read);
    },
    tick: (id, on) => {
      const { run } = get();
      if (run?.cleanup) set({ run: { ...run, cleanup: { ...run.cleanup, ticks: { ...run.cleanup.ticks, [id]: on } } } });
    },
    pickSkill: (path, pick) => {
      const { run } = get();
      if (run?.cleanup) set({ run: { ...run, cleanup: { ...run.cleanup, skills: { ...run.cleanup.skills, [path]: pick } } } });
    },
    previewPr: async () => {
      const { run, projects, clashes, agent } = get();
      const project = run && pickedProject(run, projects);
      if (!run?.repo || !project) return set({ changes: { state: 'failed', error: 'T3 Code no longer has the picked project. Go Back and pick one.' } });
      const preview = ++previews;
      const config = prConfig(run, project);
      const picks = picksOf(run, clashes, agent);
      if (config === undefined || !picks) {
        return set({ changes: { state: 'failed', error: 'Go Back to Cleanup and wait for its checks, then come back to see the PR’s changes.' } });
      }
      set({ changes: { state: 'reading' } });
      const answer = await postAction<{ changes: OnboardingPrChange[] }>('/api/onboarding/pr/changes', { repo: run.repo, config, picks });
      if (preview !== previews || !get().run) return;
      set({ changes: answer.error || !answer.changes ? { state: 'failed', error: answer.error ?? 'The board sent no changes.' } : { state: 'read', changes: answer.changes } });
    },
    readPrChanges: async () => {
      const { run, changes } = get();
      if (!run || run.step !== 'pr' || changes && changes.state !== 'failed') return;
      set({ changes: { state: 'reading' } });
      await Promise.all([get().findClashes(), get().readClashRuns()]);
      if (get().run?.repo === run.repo && get().run?.step === 'pr') await get().previewPr();
    },
    openPr: async () => {
      const { run, projects, clashes, agent, pr } = get();
      const project = run && pickedProject(run, projects);
      const config = run && project ? prConfig(run, project) : undefined;
      const picks = run && picksOf(run, clashes, agent);
      // The PR opens only once its changes are listed, so it never holds what the step couldn't show.
      if (!run?.repo || !run.projectId || run.step !== 'pr' || run.prUrl || pr.opening || pr.reopening || config === undefined || !picks
        || get().changes?.state !== 'read') return;
      set({ pr: { ...IDLE, opening: true } });
      const body = { repo: run.repo, progress: progressOf({ ...run, projectId: run.projectId }), config, picks, ...replacing({ ...run, repo: run.repo }) };
      const result = await postAction<{ prUrl: string }>('/api/onboarding/pr', body);
      receive(result);
      const now = get().run;
      // The run closed while gh ran; the board kept the PR with its onboarding, which Resume reopens.
      if (!now || now.repo !== run.repo) return;
      if (result.error || !result.prUrl) return set({ pr: { ...IDLE, error: result.error ?? 'The board sent no PR.' } });
      set({ run: { ...now, prUrl: result.prUrl, savedAs: run.repo }, pr: IDLE });
    },
    reopenPr: async () => {
      const { run, pr } = get();
      if (!run?.repo || !prClosed(run, useBoardStore.getState().data) || pr.reopening) return;
      set({ pr: { ...IDLE, reopening: true } });
      const result = await postAction('/api/onboarding/pr/reopen', { repo: run.repo });
      receive(result);
      if (get().run?.repo !== run.repo) return;
      set({ pr: { ...IDLE, error: result.error } });
    },
    startOver: async () => {
      const { run } = get();
      if (!run || !prClosed(run, useBoardStore.getState().data) || get().pr.reopening || get().changes?.state !== 'read') return;
      set({ run: { ...run, prUrl: null }, pr: IDLE });
      await get().openPr();
    },
    checkMerge: async () => {
      const { run, pr } = get();
      if (!run?.prUrl || pr.checking) return;
      set({ pr: { ...pr, checking: true, error: null } });
      // Listen before asking, so a read that answers before the post does still counts.
      const { read, cancel } = nextRead(useBoardStore.getState().data);
      const asked = await postAction('/api/read', {});
      if (asked.error) cancel();
      const data = asked.error ? null : await read;
      // The run closed, or moved to another PR, while the board read.
      if (get().run?.prUrl !== run.prUrl) return;
      const followed = data?.onboarding?.find((o) => o.progress.prUrl === run.prUrl)?.followProblem;
      const error = asked.error ?? (data ? data.error ?? followed : 'The board hasn’t read GitHub yet. It checks again on its next refresh.');
      set({ pr: { ...get().pr, checking: false, checkedAt: error ? get().pr.checkedAt : Date.now(), error: error ?? null } });
    },
  };
});
