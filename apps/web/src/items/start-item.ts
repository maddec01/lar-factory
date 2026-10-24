// Start on a Queued item, or Start build on a Ready one: posts the picked model choice to
// /api/start or /api/start-build, shows the thread it started or why it didn't, and remembers the
// choice once a thread starts or may have.

import { flushSync } from 'react-dom';
import { remembersChoice, startRequest } from '@mux-factory/shared';
import type { ModelChoice, StartResult } from '@mux-factory/shared';
import { useActionStore } from './action-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from './card-actions.ts';
import { refocus } from '../notices/toasts.tsx';
import { notify } from '../notices/notices.tsx';
import { startOf, useStartStore } from './start-store.ts';
import type { StartKind } from './start-store.ts';

const PATH: Record<StartKind, string> = { refine: '/api/start', build: '/api/start-build' };

export async function startItem(itemId: string, choice?: ModelChoice, kind: StartKind = 'refine'): Promise<void> {
  const starts = useStartStore.getState();
  if (startOf(starts, itemId, kind)?.phase === 'pending' || useActionStore.getState().actions[itemId]?.phase === 'pending') return;
  starts.set(itemId, { phase: 'pending' }, kind);
  const result = await postAction<StartResult>(PATH[kind], startRequest(useBoardStore.getState().data.capture?.session, itemId, choice));
  flushSync(() => {
    receive(result);
    starts.set(itemId, result.thread ? { phase: 'started', thread: result.thread }
      : { phase: result.uncertain ? 'uncertain' : 'error', message: result.error ?? 'The thread did not start.' }, kind);
    // A refused or failed start keeps the previous choice.
    if (remembersChoice(result)) starts.remember(choice);
    const item = useBoardStore.getState().data.items.find((i) => i.id === itemId);
    if (result.thread && item) notify({ verb: 'Started', item, thread: result.thread });
  });
  // The Start button is gone once a thread starts or may have started; move focus to what replaced it.
  refocus([`[data-start-result="${CSS.escape(itemId)}"]`]);
}
