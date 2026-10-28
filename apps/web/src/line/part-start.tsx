// A dossier part's Start, in its checklist step, its map node and the dossier's header: Start build on a Ready build,
// today's Start on a Queued decision, Open thread while it has a live thread. While an issue it's blocked by is open,
// Start after takes Start's place.

import { workMessage } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import type { Part } from './dossier-parts.ts';

/** `build` names Start build, which the map shortens to Start; other statuses get none. */
export function PartStart({ part, data, build = 'Start build' }: { part: Part; data: BoardData; build?: string }) {
  const { item } = part;
  if (item.status === 'Ready') return <StartBuild item={item} data={data} label={build} />;
  if (item.status !== 'Queued' || !workMessage(item)) return null;
  // A thread already at work on the item would get a second one.
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;
  return <StartOrAfter item={item} data={data} />;
}
