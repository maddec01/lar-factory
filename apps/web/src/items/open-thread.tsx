// Open thread: an Open, a link that opens an item's latest T3 thread in T3 Code, or a disabled button whose
// title says why it can't: the item has no thread yet, T3's database can't be read, T3 hasn't
// written its environment id, or the thread is archived, whose link T3 opens as New thread.

import { isLiveThread, needsAnswer, openQuestionThread, threadLink } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';
import { ICON, kind } from '../buttons/button-kinds.tsx';
import { LinkButton } from './link-button.tsx';
import { useOnRow } from './row-actions.tsx';

/** A child question may belong to its nearest concept's thread before it has a thread of its own. */
function conceptQuestionThread(item: Item, data: BoardData): ItemThread | undefined {
  if (item.status !== 'Needs you') return undefined;
  const byId = new Map(data.items.map((candidate) => [candidate.id, candidate]));
  const seen = new Set([item.id]);
  let parentId = item.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (parent.kind === 'concept') {
      if (!Array.isArray(parent.threads) || parent.threads.some((thread) => thread.observedAt)) return undefined;
      return parent.threads.find((thread) => thread.state === 'needs you' || thread.state === 'running');
    }
    parentId = parent.parentId;
  }
  return undefined;
}

/** The link stays a view of the question owner. It gives the child no thread association or usage. */
function latestThread(item: Item, data: BoardData, threadId?: string): { link: string; conceptQuestion: boolean } | { reason: string } {
  if (item.threads === 'unavailable') return { reason: 'The T3 Code database could not be read' };
  const own = threadId ? item.threads?.find((thread) => thread.id === threadId) : item.threads?.[0];
  const inherited = !threadId && !item.threads?.length ? conceptQuestionThread(item, data) : undefined;
  const latest = own ?? inherited;
  if (!latest) return { reason: 'No T3 thread has worked on this yet' };
  if (latest.archived) return { reason: 'This thread is archived in T3 Code' };
  if (!data.t3EnvironmentId) return { reason: "T3 Code hasn't written its environment id" };
  return { link: threadLink(data.t3EnvironmentId, latest.id), conceptQuestion: !own && Boolean(inherited) };
}

/** Whether a thread on the item is running, queued or waits on you, so starting another would make a second one. */
export const hasLiveThread = (item: Item): boolean =>
  Array.isArray(item.threads) && item.threads.some(isLiveThread);

/**
 * Opens the latest thread, or the phase's recorded `threadId`, in T3 Code: the board app hands the link to T3, a browser asks to open it. `iconOnly` draws
 * it as a square icon button, its label in its title, as a desk card's corner does. On a row, Open thread is always that
 * icon, with a tooltip on hover and keyboard focus that says its label or why it can't open; other labels stay as text.
 */
export function OpenThread({ item, data, label = 'Open thread', iconOnly: given = false, threadId }: { item: Item; data: BoardData; label?: string; iconOnly?: boolean; threadId?: string }) {
  const thread = latestThread(item, data, threadId);
  const actionLabel = 'link' in thread && thread.conceptQuestion ? 'Answer in concept thread' : label;
  const onRow = useOnRow();
  const iconOnly = given || (onRow && actionLabel === 'Open thread');
  const tooltip = onRow && iconOnly;
  // A square Open, the thread icon alone, named by its label.
  const named = iconOnly ? { 'aria-label': actionLabel, 'data-icon-only': '' } : {};
  const shown = iconOnly ? null : actionLabel;
  // Pointer events stay on while it's disabled, so its title says why; TooltipTrigger gives a disabled one its own focusable hover target.
  const button = 'link' in thread
    ? <LinkButton kind="open" leftIcon={ICON.thread} data-open-thread={item.id} href={thread.link} title={iconOnly && !tooltip ? actionLabel : undefined} {...named}>{shown}</LinkButton>
    : <Button {...kind('open')} leftIcon={ICON.thread} className={tooltip ? '' : 'disabled:pointer-events-auto'} data-open-thread={item.id} disabled title={tooltip ? undefined : thread.reason} {...named}>{shown}</Button>;
  if (!tooltip) return button;
  return <Tooltip><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipPopup>{'link' in thread ? actionLabel : thread.reason}</TooltipPopup></Tooltip>;
}

/**
 * The threads details lists beside Open thread: archived ones as text alone, since the only thing T3 offers for one is
 * Unarchive, and earlier shaping threads, or any earlier thread of a decision but the one Answer in T3 links, with their
 * links. A thread T3 or the board deleted isn't on the item.
 */
export function EarlierThreads({ item, data }: { item: Item; data: BoardData }) {
  const earlier = Array.isArray(item.threads) ? item.threads.filter((thread, index) => thread.archived || (index > 0 && (thread.purpose === 'shape' || (item.kind === 'decision' && !(needsAnswer(item) && thread.id === openQuestionThread(item)?.id))))) : [];
  if (!earlier.length) return null;
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-xs text-(--muted-foreground)" data-earlier-threads>
      {earlier.map((thread) => (
        <li key={thread.id} className="flex min-w-0 items-center gap-1.5" title={thread.title}>
          {!thread.archived && data.t3EnvironmentId
            ? <a href={threadLink(data.t3EnvironmentId, thread.id)} className="truncate underline">T3 · {thread.title}</a>
            : <span className="truncate">T3 · {thread.title}</span>}{' '}
          <span className="shrink-0">· {thread.archived ? 'archived' : thread.purpose === 'shape' ? 'shaping' : 'earlier'}</span>
        </li>
      ))}
    </ul>
  );
}
