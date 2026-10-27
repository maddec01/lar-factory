// The onboarding run the dialog shows: its step, the steps it has passed, the T3 project it picked and the answers it
// has given, with T3's projects as the server lists them and the folder Create a new T3 project adds. Closing before a
// project is picked, or an offered run before Next or any change, drops the run; closing after keeps its repository on
// this Mac's list as onboarding, with where it stopped, and Resume reopens it there. The Checks step runs the command checks, then the setup checks, and holds Next
// until each passes. The Cleanup step runs the fixed checks for known Clashes, keeps the user's ticks and skill picks
// with the run, and holds Next until each project skill named like a bundled skill is deleted or renamed. A run that
// reuses its .lar-factory.json finishes there, with no PR, until build #384's PR writer. Any other run opens the
// onboarding PR on the Pull request step, then waits for the board to finish the onboarding once the PR merges. A PR
// the board finds closed without merging offers Reopen PR, or Start over, which opens a new one.

import { create } from 'zustand';
import {
  SETUP_CHECKS, isOnboarding, sameRepo, skillRenameProblem, type BoardData, type CheckedTool, type Clash, type CleanupPicks, type FixedClashes, type OnboardingOffer, type OnboardingProgress, type ProjectChoice, type Provider, type RepositoryConfigAnswers, type RepositoryItemSource,
  type SetupAnswers, type SetupCheckId, type SetupCheckResult, type ShowSetting, type SkillClash, type SkillPick, type ToolChecks,
} from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { showToast } from '../notices/toasts.tsx';

/** The steps in order. Build #383 (labels) adds its own here. */
export const STEPS = [
  { id: 'project', label: 'T3 project' },
  { id: 'setup', label: 'Provider and item source' },
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

/** The show setting suggested for an item source: All items for a GitHub Project, Opted-in items for issues. */
export const suggestedShow = (itemSource: SetupAnswers['itemSource']): ShowSetting => itemSource === 'github-project' ? 'all' : 'opted-in';

/** Whether the setup step asks its questions: a GitHub repository with no .lar-factory.json to reuse. */
export const asksSetup = (project: ProjectChoice): boolean => project.provider === 'GitHub' && project.hasConfig === false;

/** A GitHub login, as .lar-factory.json's itemSource.owner takes it. */
const GITHUB_LOGIN = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;

/** What each of the setup step's answers that Next waits for needs: a role, and for a GitHub Project its owner and a positive whole number. */
export function setupProblems(setup: SetupAnswers): Partial<Record<'projectOwner' | 'projectNumber' | 'role', string>> {
  const project = setup.itemSource === 'github-project';
  return {
    ...project && !GITHUB_LOGIN.test(setup.projectOwner) && { projectOwner: 'Next needs a GitHub login: letters, digits and single hyphens, not at either end.' },
    ...project && !/^[1-9]\d*$/.test(setup.projectNumber) && { projectNumber: 'Next needs the number, a positive whole number like 3.' },
    ...!setup.role.trim() && { role: 'Next needs the repository’s role.' },
  };
}

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
  return itemSource && run.setup && { itemSource, show: run.setup.show, role: run.setup.role.trim() };
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

/** Whether a Clash's edit goes in the PR: the user's tick, else as the check offers it. */
export const ticked = (clash: Clash, picks: CleanupPicks | null): boolean => picks?.ticks[clash.id] ?? clash.ticked;

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

/** Whether the fixed checks ran and each skill Clash is picked. */
const cleanupDone = (run: Run, clashes: Clashes | null): boolean =>
  clashes?.state === 'read' && clashes.found.skillClashes.every((skill) => !skillProblem(skill, run.cleanup, clashes));

/** Whether the run finishes on the Cleanup step: it reuses its .lar-factory.json, so it opens no PR until build #384's PR writer. */
export const finishesOnCleanup = (run: Run, projects: Projects): boolean => run.step === 'cleanup' && !!pickedProject(run, projects)?.config;

/** Whether the run's step lets Next move past it. */
export function stepReady(run: Run, projects: Projects, checks: Checks | null = null, tools?: ToolChecks, clashes: Clashes | null = null): boolean {
  const project = pickedProject(run, projects);
  if (!project) return false;
  if (run.step === 'project') return true;
  if (run.step === 'setup') return !!project.config || asksSetup(project) && setupAnswered(run.setup);
  if (run.step === 'checks') return checksPassed(checks, tools, itemSourceOf(run, project));
  if (run.step === 'cleanup') return cleanupDone(run, clashes);
  return false;
}

interface WizardState {
  /** The run the dialog shows; null while it's closed. */
  run: Run | null;
  projects: Projects;
  /** Create a new T3 project's form; null while a listed project is the choice. */
  creating: Creating | null;
  /** The Checks step's checks; null until the run first reaches it. */
  checks: Checks | null;
  /** The Cleanup step's fixed checks; null until the run first reaches it. */
  clashes: Clashes | null;
  /** Finish for a run that reuses its .lar-factory.json: whether it's running, and why the board refused it. */
  finishing: { running: boolean; error: string | null };
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
  answer: (change: Partial<Omit<SetupAnswers, 'showPicked'>>) => void;
  next: () => void;
  back: () => void;
  /** Runs the command checks, then each setup check in turn. */
  runChecks: () => Promise<void>;
  /** Runs one setup check again. */
  retryCheck: (id: SetupCheckId) => Promise<void>;
  /** Runs the fixed checks for known Clashes on the run's repository. */
  findClashes: () => Promise<void>;
  /** Ticks or unticks a Clash's edit, by its id. */
  tick: (id: string, on: boolean) => void;
  /** Picks Delete or Rename for a skill Clash, by its path. */
  pickSkill: (path: string, pick: SkillPick) => void;
  /** Finishes a run that reuses its .lar-factory.json once its Cleanup step is done, so its repository goes on the board. */
  finish: () => Promise<void>;
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
/** The run an offer opened, until Next or a change replaces it; closing it then keeps nothing. */
let untouchedOffer: Run | null = null;

const NOT_FINISHING: WizardState['finishing'] = { running: false, error: null };

/** The Cleanup step's picks before any is changed. */
const NO_PICKS: CleanupPicks = { ticks: {}, skills: {} };

const IDLE: WizardState['pr'] = { opening: false, reopening: false, checking: false, checkedAt: null, error: null };

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
    provider: progress.answers.provider ?? null, savedAs: repo, setup: progress.answers.setup ?? null, cleanup: progress.answers.cleanup ?? null,
    prUrl: progress.prUrl ?? null };
}

/** The setup step's answers before any is given: a GitHub Project of the repository's owner, with its suggested show setting. */
const firstSetup = (repo: string | null): SetupAnswers => ({
  itemSource: 'github-project', projectOwner: repo?.split('/')[0] ?? '', projectNumber: '', show: suggestedShow('github-project'), showPicked: false, role: '',
});

/** Where the run stopped, as the board keeps it. */
const progressOf = (run: Run & { projectId: string }): OnboardingProgress => ({ step: run.step, done: run.done,
  answers: { projectId: run.projectId, ...run.provider && { provider: run.provider }, ...run.setup && { setup: run.setup }, ...run.cleanup && { cleanup: run.cleanup } },
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
    const { run, projects, checks, clashes } = get();
    // Once its PR is open, the run stays on the Pull request step.
    if (!run || run.prUrl || (by === 1 && !stepReady(run, projects, checks, useBoardStore.getState().data.tools, clashes))) return;
    const to = STEPS[STEPS.findIndex((s) => s.id === run.step) + by]?.id;
    if (to) set({ run: { ...run, step: to, done: by === 1 ? [...new Set([...run.done, run.step])] : run.done,
      setup: run.setup ?? (to === 'setup' ? firstSetup(run.repo) : null), cleanup: run.cleanup ?? (to === 'cleanup' ? NO_PICKS : null) } });
    if (to === 'checks') void get().runChecks();
    if (to === 'cleanup') void get().findClashes();
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
    finishing: NOT_FINISHING,
    pr: IDLE,
    opener: null,
    start: (offer) => {
      checkRuns++;
      // The board offers only GitHub repositories until build #386.
      clashReads++;
      const run: Run = { step: 'project', done: [], projectId: offer?.projectId ?? null, repo: offer?.repo ?? null, provider: offer ? 'GitHub' : null,
        savedAs: null, setup: null, cleanup: null, prUrl: null };
      untouchedOffer = offer ? run : null;
      set({ run, creating: null, checks: null, clashes: null, finishing: NOT_FINISHING, pr: IDLE, opener: focused() });
      void get().loadProjects();
    },
    resume: (repo) => {
      const kept = useBoardStore.getState().data.onboarding?.find((o) => sameRepo(o.repo, repo));
      if (!kept) return;
      checkRuns++;
      clashReads++;
      set({ run: resumed(kept.repo, kept.progress), creating: null, checks: null, clashes: null, finishing: NOT_FINISHING, pr: IDLE, opener: focused() });
      // The checks read the picked project, so they wait for T3's projects; the fixed checks read only the repository.
      if (get().run!.step === 'cleanup') void get().findClashes();
      void get().loadProjects().then(() => { if (get().run?.step === 'checks') void get().runChecks(); });
    },
    close: () => {
      const { run } = get();
      reads++;
      checkRuns++;
      clashReads++;
      set({ run: null, checks: null, clashes: null });
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
      const setup = { ...run.setup, ...change };
      if (change.show) setup.showPicked = true;
      else if (change.itemSource && !setup.showPicked) setup.show = suggestedShow(change.itemSource);
      set({ run: { ...run, setup } });
    },
    next: () => move(1),
    back: () => move(-1),
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
    tick: (id, on) => {
      const { run } = get();
      if (run?.cleanup) set({ run: { ...run, cleanup: { ...run.cleanup, ticks: { ...run.cleanup.ticks, [id]: on } } } });
    },
    pickSkill: (path, pick) => {
      const { run } = get();
      if (run?.cleanup) set({ run: { ...run, cleanup: { ...run.cleanup, skills: { ...run.cleanup.skills, [path]: pick } } } });
    },
    finish: async () => {
      const { run, projects, checks, clashes, finishing } = get();
      if (!run?.repo || finishing.running || !finishesOnCleanup(run, projects)
        || !stepReady(run, projects, checks, useBoardStore.getState().data.tools, clashes)) return;
      set({ finishing: { running: true, error: null } });
      const result = await postAction('/api/onboarding/finish', { repo: run.repo, ...replacing({ ...run, repo: run.repo }) });
      receive(result);
      // The run closed while the board finished it.
      if (get().run?.repo !== run.repo) return;
      if (result.error) return set({ finishing: { running: false, error: result.error } });
      checkRuns++;
      clashReads++;
      set({ run: null, checks: null, clashes: null, finishing: NOT_FINISHING });
      showToast({ slot: 'onboarding', what: `Onboarded ${run.repo}`, body: `Onboarded ${run.repo}. Its items show once the board reads them.` });
    },
    openPr: async () => {
      const { run, projects, pr } = get();
      const project = run && pickedProject(run, projects);
      const config = run && project && configOf(run, project);
      if (!run?.repo || !run.projectId || run.step !== 'pr' || run.prUrl || pr.opening || pr.reopening || !config) return;
      set({ pr: { ...IDLE, opening: true } });
      const body = { repo: run.repo, progress: progressOf({ ...run, projectId: run.projectId }), config, ...replacing({ ...run, repo: run.repo }) };
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
      if (!run || !prClosed(run, useBoardStore.getState().data) || get().pr.reopening) return;
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
