import { create } from 'zustand';
import {
  isOnboarding, sameRepo, newLabelProblem, writeAccessProblem, type BoardData, type OnboardingChoices,
  type OnboardingProgress, type ProjectChoice, type Provider, type SetupDetection,
} from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { showToast } from '../notices/toasts.tsx';
import { STEP_TITLES, answerProblem, answersOf, connectionsOf, isStep, missingSyncAccess, stepsOf, type StepId } from './wizard-choices.ts';

/** Where a kept onboarding stopped, as a phrase; a step this dialog doesn't have, as an older board's, reads as the first. */
export const stoppedAt = ({ step }: OnboardingProgress): string => `stopped at ${STEP_TITLES[isStep(step) ? step : 'project']}`;

export interface Run {
  step: StepId;
  /** The picked T3 project's id. */
  projectId: string | null;
  /** The picked T3 project's repository. */
  repo: string | null;
  /** The picked T3 project's provider, from its origin's host; null until one is picked. */
  provider: Provider | null;
  /** The repository the run was kept under when it was last closed; null for a run never kept. */
  savedAs: string | null;
  choices: OnboardingChoices;
}

export type Projects = { state: 'loading' } | { state: 'loaded'; projects: ProjectChoice[] } | { state: 'failed'; error: string };

/** Create a new T3 project, while it's the T3 project step's choice: the folder to add, and how adding it went. */
interface Creating {
  folder: string;
  adding: boolean;
  error: string | null;
}

/** A read the board answers: running, answered, or the board's problem. */
export type Read<T> = { state: 'reading' } | { state: 'read'; value: T } | { state: 'failed'; error: string };

type Finish = { state: 'idle' } | { state: 'saving' } | { state: 'failed'; error: string } | { state: 'done' };

/**
 * Why a T3 project can't be picked, or null when it can. The repository a resumed run was kept under stays pickable;
 * another one still onboarding is resumed from its own Resume.
 */
export function unpickable(project: ProjectChoice, run: Run, data: Pick<BoardData, 'onboarding'> = useBoardStore.getState().data): string | null {
  if (project.onBoard && !(project.repo && run.savedAs && sameRepo(project.repo, run.savedAs))) {
    return isOnboarding(data, project.repo) ? 'Setup is already in progress. Close this window and choose Resume.' : 'This repository is already on the board.';
  }
  if (!project.repo) return 'Choose a repository folder connected to GitHub or Azure DevOps.';
  return null;
}

/** The run's picked project, from T3's projects. */
export function pickedProject(run: Run, projects: Projects): ProjectChoice | null {
  return projects.state === 'loaded' ? projects.projects.find((p) => p.id === run.projectId) ?? null : null;
}

/** The run's detection, once read. */
export const detectedOf = (detection: Read<SetupDetection> | null): SetupDetection | null => (detection?.state === 'read' ? detection.value : null);

/** The steps the run shows, as its detection shapes them. */
export const runSteps = (run: Run, detection: Read<SetupDetection> | null): StepId[] => stepsOf();

/** Whether the current step has everything needed to continue. */
export function stepReady(run: Run, projects: Projects, detection: Read<SetupDetection> | null): boolean {
  if (!pickedProject(run, projects)) return false;
  if (run.step === 'project') return true;
  const detected = detectedOf(detection);
  if (!detected || !('found' in detected.checkout)) return false;
  const answers = answersOf(detected, run.choices);
  const options = detected.azureReadOnly === undefined ? {} : { azureReadOnly: detected.azureReadOnly };
  const terms = Object.values(run.choices.vocabulary ?? {});
  if (terms.some((term) => term.type !== null) && writeAccessProblem(detected.repo, 'type-ticket', detected.access, options)) return false;
  if (terms.some((term) => term.labels.length) && writeAccessProblem(detected.repo, 'tag-ticket', detected.access, options)) return false;
  if (Object.values(run.choices.newLabels ?? {}).some((names) => names?.length) && newLabelProblem(detected.repo, detected.access, options)) return false;
  if (answerProblem(run.step, answers) || !answers.itemSource) return false;
  return run.step !== 'access' || !answers.structureSync || missingSyncAccess(detected).length === 0;
}

interface WizardState {
  /** The run the dialog shows; null while it's closed. */
  run: Run | null;
  projects: Projects;
  /** Create a new T3 project's form; null while a listed project is the choice. */
  creating: Creating | null;
  /** What we found; null until the run first reaches it. */
  detection: Read<SetupDetection> | null;
  finish: Finish;
  /** The button that opened the dialog, which gets focus back when it closes. */
  opener: HTMLElement | null;
  /** Opens a new run. */
  start: () => void;
  /** Reopens the onboarding the board keeps for `repo`, on its step with its choices. */
  resume: (repo: string) => void;
  close: () => void;
  /** Reads T3's projects again. */
  loadProjects: () => Promise<void>;
  /** Picks a T3 project; another one than before drops what the run detected and chose. */
  pick: (projectId: string) => void;
  /** Chooses Create a new T3 project, which unpicks the picked project. */
  chooseNew: () => void;
  setFolder: (folder: string) => void;
  /** Adds the form's folder as a T3 project and picks it. */
  createProject: () => Promise<void>;
  /** Detects the picked repository's setup again. */
  detect: () => Promise<void>;
  /** Changes local setup choices. */
  choose: (change: OnboardingChoices) => void;
  next: () => Promise<void>;
  back: () => void;
  save: () => Promise<void>;

}

/** Counts project reads, so one answered after a newer read or a close is dropped. */
let reads = 0;
/** Counts the run's other reads, so one answered after a newer one, another project or a close is dropped. */
let detections = 0;

/** The focused element, as the button that opens the dialog; null when nothing is. */
const focused = (): HTMLElement | null => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

/** The run a kept onboarding resumes; a step this dialog doesn't have, as an older board's, resumes on the T3 project step. */
const resumed = (repo: string, progress: OnboardingProgress): Run => ({ step: isStep(progress.step) ? progress.step : 'project',
  projectId: progress.answers.projectId, repo, provider: progress.answers.provider ?? null, savedAs: repo, choices: progress.answers.choices ?? {} });

/** Where the run stopped, as the board keeps it, with the steps before it as done. */
function progressOf(run: Run & { projectId: string }, detection: Read<SetupDetection> | null): OnboardingProgress {
  const steps = runSteps(run, detection);
  return { step: run.step, done: steps.slice(0, Math.max(0, steps.indexOf(run.step))),
    answers: { projectId: run.projectId, ...run.provider && { provider: run.provider }, ...Object.keys(run.choices).length && { choices: run.choices } } };
}

/** The onboarding a run kept under another repository replaces, to send with its repository. */
const replacing = (run: Run & { repo: string }) => run.savedAs && !sameRepo(run.savedAs, run.repo) ? { replaces: run.savedAs } : {};

/** Asks the server to keep the run's repository as onboarding; a refusal shows in a toast. */
async function keep(run: Run & { projectId: string; repo: string }, detection: Read<SetupDetection> | null): Promise<void> {
  const result = await postAction('/api/onboarding/repositories', { repo: run.repo, progress: progressOf(run, detection), ...replacing(run) });
  receive(result);
  if (result.error) showToast({ slot: 'onboarding', failed: true, what: ` error for onboarding ${run.repo}`,
    body: `Couldn't keep onboarding ${run.repo} on the board. ${result.error}` });
}

const FRESH = { detection: null, finish: { state: 'idle' } } as const;

export const useWizardStore = create<WizardState>()((set, get) => {
  /** Drops every read the run is waiting for. */
  const forget = () => { detections++; };

  /** Reads what a step shows when the run reaches it, unless it has it already. */
  const enter = (step: StepId) => {
    const { detection } = get();
    if (step !== 'project' && !detection) void get().detect();
  };

  const move = (by: 1 | -1) => {
    const { run, detection } = get();
    if (!run) return;
    const steps = runSteps(run, detection);
    const to = steps[steps.indexOf(run.step) + by];
    if (!to) return;
    set({ run: { ...run, step: to } });
    enter(to);
  };

  return {
    run: null,
    projects: { state: 'loading' },
    creating: null,
    ...FRESH,
    opener: null,
    start: () => {
      forget();
      const run: Run = { step: 'project', projectId: null, repo: null, provider: null, savedAs: null, choices: {} };
      set({ run, creating: null, ...FRESH, opener: focused() });
      void get().loadProjects();
    },
    resume: (repo) => {
      const kept = useBoardStore.getState().data.onboarding?.find((o) => sameRepo(o.repo, repo));
      if (!kept) return;
      forget();
      const run = resumed(kept.repo, kept.progress);
      set({ run, creating: null, ...FRESH, opener: focused() });
      void get().loadProjects();
      if (run.step !== 'project') void get().detect().then(() => { const now = get().run; if (now) enter(now.step); });
    },
    close: () => {
      const { run, detection, finish } = get();
      reads++;
      forget();
      set({ run: null, ...FRESH });
      // A run Finish saved is on the board, so there's no onboarding left to keep.
      if (run?.projectId && run.repo && finish.state !== 'done') keep({ ...run, projectId: run.projectId, repo: run.repo }, detection);
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
      if (!run || !project || unpickable(project, run)) return;
      const same = run.projectId === projectId;
      if (!same) forget();
      set({ run: { ...run, projectId, repo: project.repo, provider: project.provider, choices: same ? run.choices : {} }, creating: null, ...!same && FRESH });
    },
    chooseNew: () => {
      const { run, creating } = get();
      if (!run) return;
      forget();
      set({ run: { ...run, projectId: null, repo: null, provider: null, choices: {} }, creating: creating ?? { folder: '', adding: false, error: null }, ...FRESH });
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
      const reason = added ? unpickable(added, run) : 'T3 Code doesn\'t list it.';
      if (reason) return set({ creating: { ...now, adding: false, error: `T3 Code added the project, but it can't be picked: ${reason}` } });
      get().pick(result.projectId);
    },
    detect: async () => {
      const { run } = get();
      if (!run?.repo || !run.projectId) return;
      const read = ++detections;
      set({ detection: { state: 'reading' } });
      const answer = await postAction<{ detection: SetupDetection }>('/api/onboarding/detect', { repo: run.repo, projectId: run.projectId });
      if (read !== detections || !get().run) return;
      set({ detection: answer.detection ? { state: 'read', value: answer.detection } : { state: 'failed', error: answer.error ?? 'The board sent no detection.' } });
    },
    choose: (change) => {
      const { run } = get();
      if (run) set({ run: { ...run, choices: { ...run.choices, ...change } } });
    },
    next: async () => {
      const { run, projects, detection } = get();
      if (!run || !stepReady(run, projects, detection)) return;
      if (get().run?.step === run.step) move(1);
    },
    back: () => move(-1),
    save: async () => {
      const { run, projects, detection, finish } = get();
      const detected = detectedOf(detection);
      const steps = run && runSteps(run, detection);
      if (!run?.repo || !run.projectId || !detected || finish.state === 'saving' || finish.state === 'done' || run.step !== steps?.at(-1)
        || !stepReady(run, projects, detection)) return;
      const answers = answersOf(detected, run.choices);
      set({ finish: { state: 'saving' } });
      const connections = connectionsOf(run.repo, answers.role, run.choices, useBoardStore.getState().data.repos);
      const result = await postAction('/api/onboarding/setup', { repo: run.repo, projectId: run.projectId, ...answers, connections, ...replacing({ ...run, repo: run.repo }) });
      receive(result);
      if (get().run !== run) return;
      if (result.error) return set({ finish: { state: 'failed', error: result.error } });
      set({ finish: { state: 'done' } });
    },
  };
});
