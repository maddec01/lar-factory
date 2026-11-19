// A board row's action beside its open button: the one thing its status asks next, or where to act on work that waits
// on you, such as Start again for work whose thread is gone.
import type { BoardData, Item } from '@lar-factory/shared';
import { canRetryBuild, currentBuildThread, itemActivityThread, openBlockers } from '@lar-factory/shared';

import { YOURS } from './StageStatus';
import { HumanWaitAction, OpenThread, StartBuild, StartOrAfter, hasLiveThread, useShownStatus } from '@/features/items';

/** The row's action: what its status asks next, or the desk card's action on work that waits on you. */
export function Side({ item, data }: { item: Item; data: BoardData }) {
    const { working, resume } = useShownStatus(item);

    if (resume)
        // Tinted like the other starts: resuming is the thing you can do now.
        return <OpenThread item={item} data={data} threadId={itemActivityThread(item)?.id} label="Resume in T3" next />;

    if (working) return <OpenThread item={item} data={data} threadId={currentBuildThread(item)?.id} />;

    if (item.needsYou?.offers.includes('start-again')) return <HumanWaitAction item={item} data={data} />;

    if (YOURS.includes(item.status)) return null;

    switch (item.status) {
        case 'Queued':
            return hasLiveThread(item) ? (
                <OpenThread item={item} data={data} />
            ) : (
                <StartOrAfter item={item} data={data} />
            );
        case 'Ready':
            // A held build starts on its own once what holds it lands; the row says what that is, with nothing to press.
            return openBlockers(item).length ? null : <StartBuild item={item} data={data} />;
        case 'In progress':
            if (canRetryBuild(item)) return <StartBuild item={item} data={data} />;

            return <OpenThread item={item} data={data} />;
        case 'Shaping':
        case 'Review':
            return <OpenThread item={item} data={data} />;
        default:
            return null;
    }
}
