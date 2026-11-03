// Start shaping or building with the chosen model. Existing skill edits stay in place.

import { flushSync } from 'react-dom';
import { remembersChoice, startProgressOf, startRequest } from '@lar-factory/shared';
import type { ModelChoice, StartResult } from '@lar-factory/shared';
import { useActionStore } from './action-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from './card-actions.ts';
import { refocus } from '../notices/toasts.tsx';
import { notify } from '../notices/notices.tsx';
import { PURPOSE, startOf, useStartStore } from './start-store.ts';
import type { StartKind } from './start-store.ts';

const PATH: Record<StartKind, string> = { refine: '/api/start', build: '/api/start-build' };

/** Skill repair is a separate action in Settings. A build keeps existing skill edits. */
export async function startItem(itemId: string, choice?: ModelChoice, kind: StartKind = 'refine'): Promise<void> {
  const starts = useStartStore.getState();
  if (startOf(starts, itemId, kind)?.phase === 'pending' || useActionStore.getState().actions[itemId]?.phase === 'pending') return;
  starts.set(itemId, { phase: 'pending' }, kind);
  const result = await postAction<StartResult>(PATH[kind], {
    ...startRequest(useBoardStore.getState().data.capture?.session, itemId, choice), ...kind === 'build' && { drift: 'keep' },
  });
  flushSync(() => {
    receive(result);
    // The board says how the start went. This page keeps only an error the board doesn't hold: an unreachable server's, or a restarted one's.
    const held = result.board && startProgressOf(result.board, itemId, PURPOSE[kind]);
    starts.set(itemId, !result.error || result.uncertain || held ? undefined : { phase: 'error', message: result.error }, kind);
    // A refused or failed start keeps the previous choice.
    if (remembersChoice(result)) starts.remember(choice);
    const item = useBoardStore.getState().data.items.find((i) => i.id === itemId);
    if (result.thread && item) notify({ verb: 'Started', item, thread: result.thread, kind });
  });
  // The Start button is gone once a thread starts or may have started; move focus to what replaced it.
  refocus([`[data-start-result="${CSS.escape(itemId)}"]`]);
}
