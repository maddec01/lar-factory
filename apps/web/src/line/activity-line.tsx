// What a row says its thread is doing, in its second line's text slot: a status mark, then the newest action, its age and
// the agents at work, or what stands in for an action that isn't happening now. packages/shared/src/thread-activity.ts
// keeps the rules. The line alone follows the second's clock, so a tick renders nothing around it.

import { useSyncExternalStore } from 'react';
import { itemActivityLine, itemActivityThread, plural, shortAge } from '@lar-factory/shared';
import type { Item, ThreadActivityLine, ThreadActivityState } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { useBoardStore } from '../board/board-store.ts';
import { useActivityFeedback } from '../items/item-parts.tsx';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** One timer for the board, running while any row is mounted, since each row follows its line's state. */
function onSecond(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => { for (const each of listeners) each(); }, 1_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    timer = undefined;
  };
}

const useClock = <T,>(read: (now: number) => T): T => useSyncExternalStore(onSecond, () => read(Date.now()));

/** The state of `item`'s line, if it shows one: a start in flight says its own progress. Its caller renders only when the state changes, not on every second. */
export function useActivityState(item: Item): ThreadActivityState | undefined {
  const disconnected = useBoardStore((state) => !!state.clientError);
  const { label } = useActivityFeedback(item);
  const state = useClock((now) => itemActivityLine(item, now, disconnected)?.state);
  return label === 'Starting' || label === 'May have started' ? undefined : state;
}

/** Quiet is hollow and stopped is square, so each reads apart from working without its colour. */
const MARK: Record<ThreadActivityState, string> = {
  working: 'rounded-full bg-(--st-now)',
  quiet: 'rounded-full border-[1.5px] border-(--warning-foreground)',
  waiting: 'rounded-full bg-(--st-amber)',
  stopped: 'rounded-[1px] bg-(--st-idle)',
  unavailable: 'rounded-full border-[1.5px] border-(--st-idle)',
};

/** The line's words for its state, which `data-action` marks, whatever draws them. */
function Words({ line: { state, action } }: { line: ThreadActivityLine }) {
  switch (state) {
    case 'working': return <span data-action className="min-w-0 truncate text-(--foreground)">{action}</span>;
    case 'quiet': return <span data-action className="min-w-0 truncate font-medium tabular-nums text-(--warning-foreground)">{action}</span>;
    case 'waiting': return <Badge data-action data-activity-badge tone="warning" className="shrink-0">{action}</Badge>;
    case 'stopped': return <Badge data-action data-activity-badge className="shrink-0">{action}</Badge>;
    case 'unavailable': return <span data-action className="min-w-0 truncate">{action}</span>;
  }
}

/** The thread's agents and what each does, for the line's tooltip. */
function agentsText(item: Item): string | undefined {
  const activity = itemActivityThread(item)?.activity;
  return activity?.available ? activity.agents.map(({ title, action }) => (action ? `${title}: ${action}` : title)).join('\n') || undefined : undefined;
}

/** `item`'s line; nothing when it has none. */
export function ActivityLine({ item }: { item: Item }) {
  const disconnected = useBoardStore((state) => !!state.clientError);
  useClock((now) => Math.floor(now / 1_000));
  const line = itemActivityLine(item, Date.now(), disconnected);
  if (!line) return null;
  return (
    <span data-activity={line.state} title={line.state === 'unavailable' ? undefined : agentsText(item)} className="flex min-w-0 items-center gap-1.5">
      <span data-mark className={`inline-block size-2 shrink-0 ${MARK[line.state]}`} />
      <Words line={line} />
      {line.state !== 'quiet' && line.ageMs !== undefined && <span data-age className="shrink-0 tabular-nums">· {shortAge(line.ageMs)}</span>}
      {line.agents > 0 && <span data-agents className="shrink-0 tabular-nums">· {plural(line.agents, 'agent')}</span>}
    </span>
  );
}
