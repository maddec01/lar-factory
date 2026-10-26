// PROTOTYPE (#363), throwaway: the onboarding wizard's whole state, in memory and mocked. The three variants share it
// and differ only in where the wizard lives. `?variant=A|B|C` picks one and `?empty=1` starts with no repo onboarded.
// The bar and the prototype show only in dev or in a build made with VITE_LAR_PROTOTYPE=1 (the sample script sets it).

import { create } from 'zustand';
import { useSettingsStore } from '../settings/settings-store.ts';
import { AGENT_LOG, CHECKS, CLASHES, type Clash, SKILL_CLASH, T3_PROJECTS, type T3Project, providerOf, repoOf } from './mock.ts';

// Off under Vitest, so the board's own tests see the board as main has it.
export const PROTOTYPE = import.meta.env.MODE !== 'test' && (import.meta.env.DEV || import.meta.env.VITE_LAR_PROTOTYPE === '1');

export const VARIANTS = [
  { key: 'A', name: 'Takeover' },
  { key: 'B', name: 'Dialog' },
  { key: 'C', name: 'Checklist' },
] as const;
export type Variant = (typeof VARIANTS)[number]['key'];

export const STEPS = [
  { id: 'project', label: 'T3 project' },
  { id: 'setup', label: 'Provider and item source' },
  { id: 'checks', label: 'Checks' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'pr', label: 'Pull request' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

export type Show = 'All items' | 'Opted-in items';
export type CheckStatus = 'waiting' | 'running' | 'passed' | 'failed';

export interface Run {
  id: number;
  projectChoice: 'existing' | 'new';
  projectName: string | null;
  newPath: string;
  newOrigin: string;
  step: StepId;
  done: StepId[];
  source: 'project' | 'issues' | 'sprint' | 'backlog';
  githubProject: string;
  team: string;
  show: Show;
  /** Once the user picks a show setting, a new item source no longer changes it. */
  showTouched: boolean;
  role: string;
  platform: string;
  labels: string[];
  checks: { id: string; status: CheckStatus; failedOnce: boolean }[];
  agent: { provider: string; model: string; state: 'idle' | 'running' | 'done'; log: number };
  clashes: Clash[];
  skillChoice: 'delete' | 'rename' | null;
  skillName: string;
  pr: 'none' | 'open' | 'merged';
}

export interface RepoEntry { repo: string; platform: string; role: string; state: 'onboarded' | 'onboarding'; run?: Run }

let runs = 0;

function newRun(projectName: string | null = null): Run {
  return {
    id: ++runs, projectChoice: 'existing', projectName, newPath: '~/code/', newOrigin: '', step: 'project', done: [],
    source: 'project', githubProject: 'maddec01 #3 · lar', team: 'Fabrikam Team', show: 'All items', showTouched: false,
    role: '', platform: '', labels: ['build', 'decision', 'blocked', 'applies-to-web'], checks: [],
    agent: { provider: 'Claude', model: 'Opus 5.5', state: 'idle', log: 0 }, clashes: [], skillChoice: null, skillName: SKILL_CLASH.suggested, pr: 'none',
  };
}

/** The repository a run onboards, once one is picked. */
export function projectOf(run: Run): T3Project | null {
  if (run.projectChoice === 'new') {
    if (!run.newPath.replace(/\/$/, '').split('/').pop() || !run.newOrigin) return null;
    return { name: run.newPath.replace(/\/$/, '').split('/').pop()!, path: run.newPath, origin: run.newOrigin };
  }
  return T3_PROJECTS.find((p) => p.name === run.projectName) ?? null;
}

export const providerOfRun = (run: Run) => { const p = projectOf(run); return p ? providerOf(p.origin) : 'GitHub'; };

/** Whether a step's answers let the wizard move past it. */
export function stepReady(run: Run, step: StepId): boolean {
  const project = projectOf(run);
  switch (step) {
    case 'project': return !!project;
    case 'setup': return !!project?.config || (!!run.role.trim() && !!run.platform.trim());
    case 'checks': return run.checks.length > 0 && run.checks.every((c) => c.status === 'passed');
    case 'cleanup': return run.agent.state === 'done' && (run.skillChoice === 'delete' || (run.skillChoice === 'rename' && !!run.skillName.trim()));
    case 'pr': return run.pr === 'merged';
  }
}

const SAMPLE_REPOS: RepoEntry[] = [
  { repo: 'maddec01/lar-server', platform: 'Server', role: 'Backend API server', state: 'onboarded' },
  { repo: 'maddec01/lar-apple', platform: 'Apple', role: 'Apple client app', state: 'onboarded' },
];

/** lar-web, closed while its PR waits, so the populated board shows Resume straight away. */
function waitingLarWeb(): RepoEntry {
  const run: Run = {
    ...newRun('lar-web'), step: 'pr', done: ['project', 'setup', 'checks', 'cleanup'], role: 'Web client', platform: 'Web',
    checks: CHECKS.filter((c) => !c.azureOnly).map((c) => ({ id: c.id, status: 'passed', failedOnce: true })),
    agent: { provider: 'Claude', model: 'Opus 5.5', state: 'done', log: AGENT_LOG.length }, clashes: CLASHES, skillChoice: 'rename', pr: 'open',
  };
  return { repo: 'maddec01/lar-web', platform: 'Web', role: 'Web client', state: 'onboarding', run };
}

const params = () => new URLSearchParams(location.search);
const initialVariant = (): Variant => { const v = params().get('variant')?.toUpperCase(); return v === 'B' || v === 'C' ? v : 'A'; };
const initialRepos = (empty: boolean) => (empty ? [] : [...SAMPLE_REPOS, waitingLarWeb()]);

interface WizardState {
  variant: Variant;
  empty: boolean;
  repos: RepoEntry[];
  /** Repositories reset in this session, whose items the board stops showing. */
  resetRepos: string[];
  /** The run the wizard shows; null while it's closed. */
  run: Run | null;
  setVariant: (variant: Variant) => void;
  setEmpty: (empty: boolean) => void;
  start: (projectName?: string) => void;
  resume: (repo: string) => void;
  close: () => void;
  patch: (change: Partial<Run>) => void;
  next: () => void;
  goTo: (step: StepId) => void;
  retry: (check: string) => void;
  runAgent: () => void;
  openPr: () => void;
  merge: () => void;
  reset: (repo: string) => void;
}

const setParam = (key: string, value: string | null) => {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
};

export const useWizardStore = create<WizardState>()((set, get) => {
  /** Changes a run wherever it sits: open in the wizard, or parked on its repository after a close. */
  const patchRun = (id: number, change: (run: Run) => Partial<Run>) => set((state) => ({
    run: state.run?.id === id ? { ...state.run, ...change(state.run) } : state.run,
    repos: state.repos.map((r) => (r.run?.id === id ? { ...r, run: { ...r.run, ...change(r.run) } } : r)),
  }));

  const runCheck = (id: number, check: string, after: () => void) => {
    patchRun(id, (run) => ({ checks: run.checks.map((c) => (c.id === check ? { ...c, status: 'running' } : c)) }));
    setTimeout(() => {
      const fails = !!CHECKS.find((c) => c.id === check)?.failure;
      patchRun(id, (run) => ({ checks: run.checks.map((c) => (c.id === check ? { ...c, status: fails && !c.failedOnce ? 'failed' : 'passed', failedOnce: true } : c)) }));
      after();
    }, 550);
  };

  const runChecks = (run: Run) => {
    const azure = providerOfRun(run) === 'Azure DevOps';
    const ids = CHECKS.filter((c) => (azure ? !c.githubOnly : !c.azureOnly)).map((c) => c.id);
    patchRun(run.id, () => ({ checks: ids.map((id) => ({ id, status: 'waiting', failedOnce: false })) }));
    const step = (i: number) => { if (i < ids.length) runCheck(run.id, ids[i]!, () => step(i + 1)); };
    step(0);
  };

  /** Opens wherever the variant keeps the wizard; C lives in Settings › Repositories. */
  const show = () => {
    const settings = useSettingsStore.getState();
    if (get().variant === 'C') { if (!settings.open) settings.setOpen(true); settings.setSection('repos'); } else if (settings.open) settings.setOpen(false);
  };

  return {
    variant: initialVariant(),
    empty: params().get('empty') === '1',
    repos: initialRepos(params().get('empty') === '1'),
    resetRepos: [],
    run: null,
    setVariant: (variant) => { setParam('variant', variant); set({ variant }); },
    setEmpty: (empty) => { setParam('empty', empty ? '1' : null); set({ empty, repos: initialRepos(empty), resetRepos: [], run: null }); },
    start: (projectName) => { set({ run: newRun(projectName ?? null) }); show(); },
    resume: (repo) => { const run = get().repos.find((r) => r.repo === repo)?.run; if (run) { set({ run }); show(); } },
    close: () => {
      const { run, repos } = get();
      const project = run && projectOf(run);
      // Once a project is picked, the repository stays on the board as onboarding, with Resume.
      if (run && project && run.pr !== 'merged') {
        const repo = repoOf(project.origin);
        const entry: RepoEntry = { repo, platform: run.platform || project.config?.platform || project.name, role: run.role || project.config?.role || '', state: 'onboarding', run };
        set({ repos: repos.some((r) => r.repo === repo) ? repos.map((r) => (r.repo === repo ? entry : r)) : [...repos, entry] });
      }
      set({ run: null });
    },
    patch: (change) => set((state) => ({ run: state.run && { ...state.run, ...change } })),
    next: () => {
      const run = get().run;
      if (!run || !stepReady(run, run.step)) return;
      const i = STEPS.findIndex((s) => s.id === run.step);
      const to = STEPS[i + 1]?.id;
      if (!to) return;
      // The provider decides which item sources are on offer.
      const azure = providerOfRun(run) === 'Azure DevOps';
      const source = run.step !== 'project' ? run.source : azure ? (run.source === 'backlog' ? 'backlog' : 'sprint') : run.source === 'issues' ? 'issues' : 'project';
      const show = run.showTouched ? run.show : ({ project: 'All items', issues: 'Opted-in items', sprint: 'All items', backlog: 'Opted-in items' } as const)[source];
      set({ run: { ...run, source, show, done: [...new Set([...run.done, run.step])], step: to } });
      if (to === 'checks' && run.checks.length === 0) runChecks(get().run!);
    },
    goTo: (step) => set((state) => ({ run: state.run && (state.run.done.includes(step) || state.run.step === step ? { ...state.run, step } : state.run) })),
    retry: (check) => { const run = get().run; if (run) runCheck(run.id, check, () => {}); },
    runAgent: () => {
      const run = get().run;
      if (!run) return;
      patchRun(run.id, () => ({ agent: { ...run.agent, state: 'running', log: 0 } }));
      const tick = (n: number) => setTimeout(() => {
        if (n < AGENT_LOG.length) { patchRun(run.id, (r) => ({ agent: { ...r.agent, log: n + 1 } })); tick(n + 1); }
        else patchRun(run.id, (r) => ({ agent: { ...r.agent, state: 'done' }, clashes: CLASHES.map((c) => ({ ...c })) }));
      }, 650);
      tick(0);
    },
    openPr: () => get().patch({ pr: 'open' }),
    merge: () => {
      const run = get().run;
      const project = run && projectOf(run);
      if (!run || !project) return;
      const repo = repoOf(project.origin);
      const entry: RepoEntry = { repo, platform: run.platform || project.config?.platform || project.name, role: run.role || project.config?.role || '', state: 'onboarded' };
      set((state) => ({
        run: { ...run, pr: 'merged', done: STEPS.map((s) => s.id) },
        repos: state.repos.some((r) => r.repo === repo) ? state.repos.map((r) => (r.repo === repo ? entry : r)) : [...state.repos, entry],
      }));
    },
    reset: (repo) => set((state) => ({ repos: state.repos.filter((r) => r.repo !== repo), resetRepos: [...state.resetRepos, repo] })),
  };
});

/** Whether the board has an onboarded repository to show. */
export const useHasOnboarded = () => useWizardStore((state) => state.repos.some((r) => r.state === 'onboarded'));
