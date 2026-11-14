import { deskWait, type BoardData, type Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';

import { StartAgain } from './NeedsYou';
import { OpenThread } from './OpenThread';
import { PrAction } from './PrLink';
import { StartOrAfter } from './StartAfter';
import { StartBuild } from './StartBuild';
import { useActivityUnavailable } from './useActivityFeedback';
import { useItemDialogStore } from '@/features/item-dialog';
import { buttonKind } from '@/ui/board';

/** The card's action, and Open thread as a square icon in the right corner unless it is the action. `quiet` draws a
 *  next step outlined, as on Your desk, where its rows' amber bar already says it waits on you. */
export function HumanWaitAction({ item, data, quiet = false }: { item: Item; data: BoardData; quiet?: boolean }) {
    const action = deskWait(item, useActivityUnavailable(), data.items).action;

    if (action?.kind === 'start-again') return <StartAgain item={item} data={data} />;

    if (action?.kind === 'retry-build') return <StartBuild item={item} data={data} />;

    if (action?.kind === 'resume-shaping') return <StartOrAfter item={item} data={data} />;

    if ((item.status === 'Verify' && item.verification?.required) || action?.kind === 'details')
        return (
            <Button
                {...buttonKind(quiet ? 'open' : 'next')}
                onClick={() => useItemDialogStore.getState().open(item.id)}
            >
                {item.status === 'Verify' ? 'Verify build' : action?.label}
            </Button>
        );

    return action?.kind === 'thread' ? (
        <OpenThread item={item} data={data} threadId={action.threadId} label={action.label} next={!quiet} />
    ) : (
        <>
            <PrAction item={item} label={action?.label ?? 'Open PR'} next={!quiet} />
            <OpenThread item={item} data={data} iconOnly />
        </>
    );
}
