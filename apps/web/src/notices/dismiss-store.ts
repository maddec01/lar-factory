// Warnings closed on this page, by condition. Only clearing a condition restores its notification.

import { create } from 'zustand';
import { failedCheck } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';

export const CLIENT_ERROR = 'client-error';

interface DismissState {
  dismissed: ReadonlySet<string>;
  dismiss: (key: string) => void;
}

export const useDismissStore = create<DismissState>()((set) => ({
  dismissed: new Set(),
  dismiss: (key) => set((state) => ({ dismissed: new Set(state.dismissed).add(key) })),
}));

export const useDismissed = (key: string): boolean => useDismissStore((state) => state.dismissed.has(key));

// Reconcile every board update, even when React batches a clear and a recurrence into one paint.
// Use underlying problems before az coverage filtering, and ignore scope and screen changes.
useBoardStore.subscribe(({ data, clientError }, previous) => {
  if (data === previous.data && clientError === previous.clientError) return;
  const { dismissed } = useDismissStore.getState();
  if (!dismissed.size) return;
  const active = new Set<string>();
  if (clientError) active.add(CLIENT_ERROR);
  if (failedCheck(data.tools, 't3')?.result === 'not-running') active.add('t3');
  for (const name of ['gh', 'git', 'jq', 'curl', 'az'] as const) {
    if (failedCheck(data.tools, name)) active.add(name);
  }
  for (const problem of data.repositoryConfigProblems ?? []) active.add(`repository-config:${problem.repo.toLowerCase()}`);
  for (const problem of data.itemSourceProblems ?? []) active.add(`item-source:${problem.repo.toLowerCase()}`);
  const remaining = new Set([...dismissed].filter((key) => active.has(key)));
  if (remaining.size !== dismissed.size) useDismissStore.setState({ dismissed: remaining });
});
