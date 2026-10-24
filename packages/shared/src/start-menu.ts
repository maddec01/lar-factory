// Start ▾'s menu on a Queued card: what picking an entry posts, and how keys move through it.

import { offers } from './model.ts';
import type { ModelChoice, ModelGroup } from './model.ts';
import type { StartResult } from './t3.ts';

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

/** Whether a start's result makes its choice the one to remember: "Started" or "May have started", not a refusal or failure. */
export function remembersChoice(result: Partial<StartResult>): boolean {
  return Boolean(result.thread || result.uncertain);
}

/** A choice as the browser stores it; "T3 default" stores as null. */
export function storedChoice(choice: ModelChoice | undefined): string {
  return JSON.stringify(choice ?? null);
}

/** The choice the browser stored; none for "T3 default", nothing stored, or anything unreadable. */
export function readChoice(raw: string | null): ModelChoice | undefined {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<ModelChoice> | null;
    return typeof value?.instanceId === 'string' && typeof value.model === 'string' ? { instanceId: value.instanceId, model: value.model } : undefined;
  } catch {
    return undefined;
  }
}

/** The entry the menu highlights: the remembered choice while it is still offered, else none ("T3 default"). */
export function highlightedChoice(groups: ModelGroup[], remembered: ModelChoice | undefined): ModelChoice | undefined {
  return remembered && offers(groups, remembered) ? remembered : undefined;
}
