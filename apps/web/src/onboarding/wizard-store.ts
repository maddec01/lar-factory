// The onboarding run the dialog shows: its step, the steps it has passed and the T3 project it picked, with T3's
// projects as the server lists them. Closing drops the run.

import { create } from 'zustand';
import type { ProjectChoice } from '@lar-factory/shared';

/** The steps in order. Builds #383 (labels) and #384 (cleanup) add theirs here. */
export const STEPS = [
  { id: 'project', label: 'T3 project' },
  { id: 'setup', label: 'Provider and item source' },
  { id: 'checks', label: 'Checks' },
  { id: 'pr', label: 'Pull request' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

export interface Run {
  step: StepId;
  done: StepId[];
  /** The picked T3 project's id. */
  projectId: string | null;
}

export type Projects = { state: 'loading' } | { state: 'loaded'; projects: ProjectChoice[] } | { state: 'failed'; error: string };

/** Why a T3 project can't be picked, or null when it can. */
export function unpickable(project: ProjectChoice): string | null {
  if (project.onBoard) return 'Its repository is on the board already.';
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
  close: () => void;
  /** Reads T3's projects again. */
  loadProjects: () => Promise<void>;
  pick: (projectId: string) => void;
  next: () => void;
  back: () => void;
}

/** Counts project reads, so one answered after a newer read or a close is dropped. */
let reads = 0;

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
      set({ run: { step: 'project', done: [], projectId: null } });
      void get().loadProjects();
    },
    close: () => {
      reads++;
      set({ run: null });
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
      if (run && project && !unpickable(project)) set({ run: { ...run, projectId } });
    },
    next: () => move(1),
    back: () => move(-1),
  };
});
