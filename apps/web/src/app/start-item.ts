// Start on a Queued card: posts the picked model choice to /api/start, shows the thread it
// started or why it didn't, and remembers the choice once a thread starts or may have.

import { flushSync } from 'react-dom';
import type { ModelChoice } from '../../../server/src/model.ts';
import { remembersChoice, startRequest } from '../../../server/src/start-menu.ts';
import type { StartResult } from '../../../server/src/t3.ts';
import { useActionStore } from './action-store.ts';
import { useBoardStore } from './board-store.ts';
import { postAction, receive, refocus } from './card-actions.ts';
import { notify } from './notices.tsx';
import { useStartStore } from './start-store.ts';

export async function startItem(itemId: string, choice?: ModelChoice): Promise<void> {
  const starts = useStartStore.getState();
  if (starts.starts[itemId]?.phase === 'pending' || useActionStore.getState().actions[itemId]?.phase === 'pending') return;
  starts.set(itemId, { phase: 'pending' });
  const result = await postAction<StartResult>('/api/start', startRequest(useBoardStore.getState().data.capture?.session, itemId, choice));
  flushSync(() => {
    receive(result);
    starts.set(itemId, result.thread ? { phase: 'started', thread: result.thread }
      : { phase: result.uncertain ? 'uncertain' : 'error', message: result.error ?? 'The thread did not start.' });
    // A refused or failed start keeps the previous choice.
    if (remembersChoice(result)) starts.remember(choice);
    const item = useBoardStore.getState().data.items.find((i) => i.id === itemId);
    if (result.thread && item) notify({ verb: 'Started', item, thread: result.thread });
  });
  // The Start button is gone once a thread starts or may have started; move focus to what replaced it.
  refocus([`[data-start-result="${CSS.escape(itemId)}"]`]);
}
