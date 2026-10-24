// A dossier part's Start, in its checklist step, its map node and the dossier's header: Start build on a Ready build,
// today's Start on a Queued decision, Open thread while it has a live thread. While an issue it's blocked by is open,
// Start is disabled, its title naming the issue.

import { workMessage } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartBuild, blockedText } from '../items/start-build.tsx';
import { StartControl } from '../items/start-control.tsx';
import type { Part } from './dossier-parts.ts';

/** `build` names Start build, which the map shortens to Start; other statuses get none. */
export function PartStart({ part, data, build = 'Start build' }: { part: Part; data: BoardData; build?: string }) {
  const { item } = part;
  if (item.status === 'Ready') return <StartBuild item={item} data={data} label={build} quiet />;
  if (item.status !== 'Queued' || !workMessage(item)) return null;
  // A thread already at work on the item would get a second one.
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} size="xs" variant="outline" />;
  const blocked = blockedText(item);
  // Pointer events stay on while it's disabled, so its title says why.
  if (blocked) return <Button size="xs" variant="outline" className="disabled:pointer-events-auto" data-start={item.id} disabled title={blocked}>Start</Button>;
  return <StartControl item={item} data={data} />;
}
