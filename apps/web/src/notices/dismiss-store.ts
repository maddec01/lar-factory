// Warnings closed on this page, by condition. Clearing a condition restores its notification, and so does an install
// warning that names something it didn't name before.

import { create } from 'zustand';
import { failedCheck } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useDriftStore } from './drift-store.ts';

export const CLIENT_ERROR = 'client-error';
/** The board app's Drift warning. */
export const DRIFT = 'drift';
/** The board app's warning about a Clash that blocks a skill. */
export const SKILL_CLASH = 'skill-clash';
/** The board app's warning about a failed install. */
export const SKILL_INSTALL_FAILED = 'skill-install-failed';

interface DismissState {
  dismissed: ReadonlySet<string>;
  dismiss: (key: string) => void;
}

export const useDismissStore = create<DismissState>()((set) => ({
  dismissed: new Set(),
  dismiss: (key) => set((state) => ({ dismissed: new Set(state.dismissed).add(key) })),
}));

export const useDismissed = (key: string): boolean => useDismissStore((state) => state.dismissed.has(key));

// Reconcile every board update and Drift change, even when React batches a clear and a recurrence into one paint.
// Use underlying problems before az coverage filtering, and ignore scope and screen changes.
function reconcile(): void {
  const { dismissed } = useDismissStore.getState();
  if (!dismissed.size) return;
  const { data, clientError } = useBoardStore.getState();
  const active = new Set<string>();
  if (clientError) active.add(CLIENT_ERROR);
  if (data.t3Availability && data.t3Availability.availability !== 'available') active.add(`t3-source:${data.t3Availability.availability}`);
  if (failedCheck(data.tools, 't3')?.result === 'not-running') active.add('t3');
  for (const name of ['gh', 'git', 'jq', 'curl', 'az'] as const) {
    if (failedCheck(data.tools, name)) active.add(name);
  }
  for (const problem of data.repositoryConfigProblems ?? []) active.add(`repository-config:${problem.repo.toLowerCase()}`);
  for (const problem of data.itemSourceProblems ?? []) active.add(`item-source:${problem.repo.toLowerCase()}`);
  const install = useDriftStore.getState();
  if (install.skills.length) active.add(DRIFT);
  if (install.blocked.length) active.add(SKILL_CLASH);
  if (install.failures.length) active.add(SKILL_INSTALL_FAILED);
  const remaining = new Set([...dismissed].filter((key) => active.has(key)));
  if (remaining.size !== dismissed.size) useDismissStore.setState({ dismissed: remaining });
}

useBoardStore.subscribe(({ data, clientError }, previous) => {
  if (data !== previous.data || clientError !== previous.clientError) reconcile();
});
/**
 * What each install warning names: each skill with Drift, each skill and path a Clash blocks, and each failed target's
 * path, or none for a failed check, so a failure's changed wording doesn't count as new.
 */
const installNames = ({ skills, blocked, failures }: Pick<ReturnType<typeof useDriftStore.getState>, 'skills' | 'blocked' | 'failures'>) => ({
  [DRIFT]: skills,
  [SKILL_CLASH]: blocked.flatMap(({ skill, paths }) => paths.map(({ path }) => `${skill} ${path}`)),
  [SKILL_INSTALL_FAILED]: failures.map(({ path }) => path ?? ''),
});

// A closed install warning shows again when it names something it didn't before, even as many as before; a shorter
// list keeps it closed.
useDriftStore.subscribe((state, previous) => {
  const now = installNames(state);
  const before = installNames(previous);
  const grown = (Object.keys(now) as Array<keyof typeof now>).filter((key) => now[key].some((name) => !before[key].includes(name)));
  const { dismissed } = useDismissStore.getState();
  if (grown.some((key) => dismissed.has(key))) {
    useDismissStore.setState({ dismissed: new Set([...dismissed].filter((key) => !(grown as string[]).includes(key))) });
  }
  reconcile();
});
