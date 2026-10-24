// Start build on a Ready item, on the line and in the item dialog: today's Start with its model menu, posting to
// /api/start-build. Open thread takes its place while the item has a running or needs-you thread, and it's disabled,
// its title saying why, while an issue it's blocked by is open or T3 has no project for its repository.

import type { ReactNode } from 'react';
import type { BoardData, Item } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { OpenThread, hasLiveThread } from './open-thread.tsx';
import { StartControl } from './start-control.tsx';

/** Why a start can't run while an issue the item is blocked by is open, naming the open ones; null once none is. */
export function blockedText(item: Item): string | null {
  if (item.blockedBy <= 0) return null;
  const open = item.blockers.filter((b) => b.state === 'OPEN').map((b) => (b.repo === item.repo ? `#${b.number}` : `${b.repo}#${b.number}`));
  return open.length ? `Blocked by ${open.join(', ')} until ${open.length > 1 ? 'they close' : 'it closes'}` : `Blocked by ${item.blockedBy} open issues`;
}

/** Why Start build can't run: the issues it's blocked by that are open, or the hint for adding its repository project. */
function heldBy(item: Item, data: BoardData): string | null {
  const blocked = blockedText(item);
  if (blocked) return blocked;
  const repo = item.repo?.toLowerCase();
  return Object.entries(data.repositoryProjects ?? {}).find(([r]) => r.toLowerCase() === repo)?.[1] ?? null;
}

/** `quiet` draws Open thread and a held Start build as outline buttons, as the line does; a dossier names it `label`. */
export function StartBuild({ item, data, label = 'Start build', size = 'xs', icon, quiet }: {
  item: Item; data: BoardData; label?: string; size?: 'xs' | 'sm'; icon?: ReactNode; quiet?: boolean;
}) {
  // A thread already at work on the item would get a second one.
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} size={size} variant={quiet ? 'outline' : undefined} />;
  const held = heldBy(item, data);
  // Pointer events stay on while it's disabled, so its title says why.
  if (held) return <Button size={size} variant={quiet ? 'outline' : undefined} className="disabled:pointer-events-auto" data-start={item.id} disabled title={held}>{icon}{label}</Button>;
  return <StartControl item={item} data={data} label={label} size={size} icon={icon} kind="build" />;
}
