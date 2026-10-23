// Start ▾'s menu on a Queued card: what picking an entry posts, and how keys move through it.

import type { ModelChoice } from './model.ts';

/** The model choice an entry names by its data attributes; "T3 default" names none. */
export function choiceOf(entry: { instanceId?: string; model?: string }): ModelChoice | undefined {
  return entry.instanceId && entry.model ? { instanceId: entry.instanceId, model: entry.model } : undefined;
}

/** /api/start's body. Without a choice it sends no `model`, so T3 uses the project's default. */
export function startRequest(session: string | undefined, itemId: string, choice?: ModelChoice): object {
  return choice ? { session, itemId, model: choice } : { session, itemId };
}

/** The entry a key moves focus to from `index` among `count`, wrapping; null for a key the menu doesn't take. */
export function menuMove(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
