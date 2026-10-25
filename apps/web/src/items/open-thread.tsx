// Open thread: a link that opens an item's latest T3 thread in T3 Code, or a disabled button whose
// title says why it can't: the item has no thread yet, T3's database can't be read, or T3 hasn't
// written its environment id.

import { threadLink } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';

/** The `t3code://` link to the item's latest thread, or why there is none. */
function latestThread(item: Item, data: BoardData): { link: string } | { reason: string } {
  if (item.threads === 'unavailable') return { reason: 'The T3 Code database could not be read' };
  const latest = item.threads?.[0];
  if (!latest) return { reason: 'No T3 thread has worked on this yet' };
  if (!data.t3EnvironmentId) return { reason: "T3 Code hasn't written its environment id" };
  return { link: threadLink(data.t3EnvironmentId, latest.id) };
}

/** Whether a thread on the item is running or waits on you, so starting another would make a second one. */
export const hasLiveThread = (item: Item): boolean =>
  Array.isArray(item.threads) && item.threads.some((t) => t.state !== 'done');

/** Opens the latest thread in T3 Code: the board app hands the link to T3, a browser asks to open it. */
export function OpenThread({ item, data, label = 'Open thread', size = 'sm', variant }: {
  item: Item; data: BoardData; label?: string; size?: 'xs' | 'sm'; variant?: 'outline';
}) {
  const thread = latestThread(item, data);
  // Pointer events stay on while it's disabled, so its title says why.
  return 'link' in thread
    ? <Button size={size} variant={variant} data-open-thread={item.id} render={<a href={thread.link} />}>{label}</Button>
    : <Button size={size} variant={variant} className="disabled:pointer-events-auto" data-open-thread={item.id} disabled title={thread.reason}>{label}</Button>;
}
