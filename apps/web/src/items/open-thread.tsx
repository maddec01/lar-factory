// Open thread: an Open, a link that opens an item's latest T3 thread in T3 Code, or a disabled button whose
// title says why it can't: the item has no thread yet, T3's database can't be read, or T3 hasn't
// written its environment id.

import { threadLink } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ICON, kind } from '../buttons/button-kinds.tsx';
import { LinkButton } from './link-button.tsx';

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
  if (!data.t3EnvironmentId) return { reason: "T3 Code hasn't written its environment id" };
  return { link: threadLink(data.t3EnvironmentId, latest.id), conceptQuestion: !own && Boolean(inherited) };
}

/** Whether a thread on the item is running or waits on you, so starting another would make a second one. */
export const hasLiveThread = (item: Item): boolean =>
  Array.isArray(item.threads) && item.threads.some((t) => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren);

/**
 * Opens the latest thread, or the phase's recorded `threadId`, in T3 Code: the board app hands the link to T3, a browser asks to open it. `iconOnly` draws
 * it as a square icon button, its label in its tooltip, as a desk card's corner does.
 */
export function OpenThread({ item, data, label = 'Open thread', iconOnly = false, threadId }: { item: Item; data: BoardData; label?: string; iconOnly?: boolean; threadId?: string }) {
  const thread = latestThread(item, data, threadId);
  const actionLabel = 'link' in thread && thread.conceptQuestion ? 'Answer in concept thread' : label;
  // A square Open, the thread icon alone, named by its label.
  const named = iconOnly ? { 'aria-label': actionLabel, 'data-icon-only': '' } : {};
  const shown = iconOnly ? null : actionLabel;
  // Pointer events stay on while it's disabled, so its title says why.
  return 'link' in thread
    ? <LinkButton kind="open" leftIcon={ICON.thread} data-open-thread={item.id} href={thread.link} title={iconOnly ? actionLabel : undefined} {...named}>{shown}</LinkButton>
    : <Button {...kind('open')} leftIcon={ICON.thread} className="disabled:pointer-events-auto" data-open-thread={item.id} disabled title={thread.reason} {...named}>{shown}</Button>;
}
