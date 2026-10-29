// A dossier part's Start, in its checklist step, its map node and the dossier's header: Start build on a Ready build,
// today's Start on a Queued decision, Open thread while it has a live thread. While an issue it's blocked by is open,
// Start after takes Start's place.

import { carriesTwoStatuses } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { openWaits } from './dossier-parts.ts';
import type { Part } from './dossier-parts.ts';

/** Whether PartStart offers the part a Start now: it is Ready or Queued, waits on no open issue, has no live thread
 *  and carries one status. The dossier's "Ready to start" row and its header's "what's next" both read it. */
export const startable = (part: Part): boolean =>
  (part.item.status === 'Ready' || part.item.status === 'Queued') && !openWaits(part).length
  && !hasLiveThread(part.item) && !carriesTwoStatuses(part.item);

/** `label` names the Start, Start build on a Ready build and Start on a Queued one by default; other statuses get none. */
export function PartStart({ part, data, label }: { part: Part; data: BoardData; label?: string }) {
  const { item } = part;
  if (item.status === 'Ready') return <StartBuild item={item} data={data} label={label ?? 'Start build'} />;
  if (item.status !== 'Queued') return null;
  // A thread already at work on the item would get a second one.
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;
  return <StartOrAfter item={item} data={data} label={label} />;
}
