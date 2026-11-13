// A dossier part's Start, in its checklist step, its map node and the dossier's header: Start build on a Ready build,
// today's Start on a Queued decision, Open thread while it has a live thread. While an issue it's blocked by is open,
// Start after takes Start's place.

import type { BoardData } from '@lar-factory/shared';

import type { Part } from './DossierParts';
import { hasLiveThread, OpenThread, StartBuild, StartOrAfter } from '@/features/items';

/** Ready work starts a build; Queued work starts shaping or a decision. Other statuses get none. */
export function PartStart({ part, data }: { part: Part; data: BoardData }) {
    const { item } = part;

    if (item.status === 'Ready') return <StartBuild item={item} data={data} />;

    if (item.status !== 'Queued') return null;

    // A thread already at work on the item would get a second one.
    if (hasLiveThread(item)) return <OpenThread item={item} data={data} />;

    return <StartOrAfter item={item} data={data} />;
}
