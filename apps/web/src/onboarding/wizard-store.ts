// The onboarding run the dialog shows: its step, the steps it has passed and the T3 project it picked, with T3's
// projects as the server lists them. Closing before a project is picked drops the run; closing after keeps its
// repository on this Mac's list as onboarding, with where it stopped, and Resume reopens it there.

import { create } from 'zustand';
import { sameRepo, type OnboardingProgress, type ProjectChoice } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { showToast } from '../notices/toasts.tsx';

/** The steps in order. Builds #383 (labels) and #384 (cleanup) add theirs here. */
export const STEPS = [
  { id: 'project', label: 'T3 project' },
  { id: 'setup', label: 'Provider and item source' },
  { id: 'checks', label: 'Checks' },
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
  /** The repository the run was kept under when it was last closed; null for a run never kept. */
  savedAs: string | null;
}

export type Projects = { state: 'loading' } | { state: 'loaded'; projects: ProjectChoice[] } | { state: 'failed'; error: string };

/** Why a T3 project can't be picked, or null when it can. The repository a resumed run was kept under stays pickable. */
export function unpickable(project: ProjectChoice, run: Run): string | null {
  if (project.onBoard && !(project.repo && run.savedAs && sameRepo(project.repo, run.savedAs))) return 'Its repository is on the board already.';
  if (!project.repo) return 'Its folder is no main checkout with a GitHub or Azure DevOps origin.';
  return null;
}

/** The run's picked project, from T3's projects. */
export function pickedProject(run: Run, projects: Projects): ProjectChoice | null {
  return projects.state === 'loaded' ? projects.projects.find((p) => p.id === run.projectId) ?? null : null;
}

/** Whether the run's step lets Next move past it. The later steps wait for the slices that fill them in. */
export function stepReady(run: Run, projects: Projects): boolean {
  return run.step === 'project' && !!pickedProject(run, projects);
}

interface WizardState {
  /** The run the dialog shows; null while it's closed. */
  run: Run | null;
  projects: Projects;
  start: () => void;
  /** Reopens the onboarding the board keeps for `repo`, on its step with its answers. */
  resume: (repo: string) => void;
  close: () => void;
  /** Reads T3's projects again. */
  loadProjects: () => Promise<void>;
  pick: (projectId: string) => void;
  next: () => void;
  back: () => void;
}

/** Counts project reads, so one answered after a newer read or a close is dropped. */
let reads = 0;

const isStep = (id: string): id is StepId => STEPS.some((s) => s.id === id);

/** The run a kept onboarding resumes; a step this dialog doesn't have, as a newer board's, resumes on the T3 project step. */
function resumed(repo: string, progress: OnboardingProgress): Run {
  return { step: isStep(progress.step) ? progress.step : 'project', done: progress.done.filter(isStep), projectId: progress.answers.projectId, repo, savedAs: repo };
}

/** Asks the server to keep the run's repository as onboarding; a refusal shows in a toast. */
async function keep(run: Run & { projectId: string; repo: string }): Promise<void> {
  const progress: OnboardingProgress = { step: run.step, done: run.done, answers: { projectId: run.projectId } };
  const replaces = run.savedAs && !sameRepo(run.savedAs, run.repo) ? { replaces: run.savedAs } : {};
  const result = await postAction('/api/onboarding/repositories', { repo: run.repo, progress, ...replaces });
  receive(result);
  if (result.error) showToast({ slot: 'onboarding', failed: true, what: ` error for onboarding ${run.repo}`,
    body: `Couldn't keep onboarding ${run.repo} on the board. ${result.error}` });
}

export const useWizardStore = create<WizardState>()((set, get) => {
  const move = (by: 1 | -1) => {
    const { run, projects } = get();
    if (!run || (by === 1 && !stepReady(run, projects))) return;
    const to = STEPS[STEPS.findIndex((s) => s.id === run.step) + by]?.id;
    if (to) set({ run: { ...run, step: to, done: by === 1 ? [...new Set([...run.done, run.step])] : run.done } });
  };

  return {
    run: null,
    projects: { state: 'loading' },
    start: () => {
      set({ run: { step: 'project', done: [], projectId: null, repo: null, savedAs: null } });
      void get().loadProjects();
    },
    resume: (repo) => {
      const kept = useBoardStore.getState().data.onboarding?.find((o) => sameRepo(o.repo, repo));
      if (!kept) return;
      set({ run: resumed(kept.repo, kept.progress) });
      void get().loadProjects();
    },
    close: () => {
      const { run } = get();
      reads++;
      set({ run: null });
      if (run?.projectId && run.repo) void keep({ ...run, projectId: run.projectId, repo: run.repo });
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
      if (run && project && !unpickable(project, run)) set({ run: { ...run, projectId, repo: project.repo } });
    },
    next: () => move(1),
    back: () => move(-1),
  };
});
