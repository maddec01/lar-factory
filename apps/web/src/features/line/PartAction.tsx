// What a concept part asks next, the same on its Work map card and its parts-list row.

import type { BoardData } from '@lar-factory/shared';
import { humanWait } from '@lar-factory/shared';

import type { Part } from './DossierParts';
import { isDone, partActivity, threadsOf } from './DossierParts';
import { PartStart } from './PartStart';
import { HumanWaitAction, OpenThread, useActivityUnavailable, useShownStatus } from '@/features/items';

/** A part's one action: nothing once it's done; where to answer while it waits on you; its Start (or Start after what
 *  holds it) while it's Ready or Queued; else its thread, when it has one. */
export function PartAction({ part, data }: { part: Part; data: BoardData }) {
    const { item } = part;
    const unavailable = useActivityUnavailable();
    const { working } = useShownStatus(item);

    if (isDone(item)) return null;

    if (humanWait(item, unavailable, data.items)) return <HumanWaitAction item={item} data={data} />;

    if (item.status === 'Ready' || item.status === 'Queued') return <PartStart part={part} data={data} />;

    return threadsOf(item).length > 0 ? (
        <OpenThread item={item} data={data} threadId={partActivity(part, working, unavailable).thread?.id} />
    ) : null;
}
