// Start build on a Ready item, on the line and in the item dialog: today's Start with its model menu, posting to
// /api/start-build. Open thread takes its place while the item has a running or needs-you thread, and it's disabled,
// its title saying why, while an issue it's blocked by is open, its repository is still onboarding or T3 has no
// project for its repository. While only a blocker holds it, Start after joins it.

import type { ReactNode } from 'react';
import type { BoardData, Item } from '@lar-factory/shared';
import { OpenThread, hasLiveThread } from './open-thread.tsx';
import { StartOrAfter } from './start-after.tsx';

/**
 * `quiet` draws Open thread and a held Start build as outline buttons, as the line does; a dossier names it `label`.
 * `afterOnly` shows Start after alone while a blocker is open, as a dossier's map does.
 */
export function StartBuild({ item, data, label = 'Start build', icon, quiet, afterOnly }: {
  item: Item; data: BoardData; label?: string; icon?: ReactNode; quiet?: boolean; afterOnly?: boolean;
}) {
  // A thread already at work on the item would get a second one.
  if (hasLiveThread(item)) return <OpenThread item={item} data={data} variant={quiet ? 'secondary' : 'primary'} />;
  return <StartOrAfter item={item} data={data} label={label} icon={icon} kind="build" quiet={quiet} afterOnly={afterOnly} />;
}
