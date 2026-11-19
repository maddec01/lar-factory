import { deskWait, type BoardData, type Item } from '@lar-factory/shared';
import { Button, Inline } from '@lar-works/design-system';

import { StartAgain } from './NeedsYou';
import { OpenThread } from './OpenThread';
import { PrFeedback } from './PrFeedback';
import { PrLink } from './PrLink';
import { StartOrAfter } from './StartAfter';
import { StartBuild } from './StartBuild';
import { useActivityUnavailable } from './useActivityFeedback';
import { useRetroChoice } from './useRetroChoice';
import { useItemDialogStore } from '@/features/item-dialog';
import { TintedActions, useButtonKind } from '@/ui/board';

/** The action on a yellow card (work that waits on you), and Open thread as a square icon in the right corner unless it is
 *  the action. A yellow card's action is always outlined, whatever surface it sits on (ButtonKinds' rule). */
export function HumanWaitAction({ item, data }: { item: Item; data: BoardData }) {
    return (
        <TintedActions tinted={false}>
            <WaitAction item={item} data={data} />
        </TintedActions>
    );
}

function WaitAction({ item, data }: { item: Item; data: BoardData }) {
    const wait = deskWait(item, useActivityUnavailable(), data.items);
    const kindOf = useButtonKind();
    const { action } = wait;

    if (!action) return null;

    if (action?.kind === 'pr-feedback') return <PrFeedback item={item} data={data} />;

    if (wait.label === 'Choose follow-ups') return <FollowupActions item={item} />;

    if (action?.kind === 'start-again') return <StartAgain item={item} data={data} />;

    if (action?.kind === 'retry-build') return <StartBuild item={item} data={data} />;

    if (action?.kind === 'resume-shaping') return <StartOrAfter item={item} data={data} />;

    if (action?.kind === 'details')
        return (
            <Button {...kindOf('open')} onClick={() => useItemDialogStore.getState().open(item.id)}>
                {action.label}
            </Button>
        );

    return action?.kind === 'thread' ? (
        <OpenThread item={item} data={data} threadId={action.threadId} label={action.label} />
    ) : (
        <>
            <PrLink item={item} label={action?.label ?? 'Open PR'} />
            <OpenThread item={item} data={data} iconOnly />
        </>
    );
}

/** Optional follow-ups can be dismissed directly, without opening a dialog or confirming twice. */
function FollowupActions({ item }: { item: Item }) {
    const { pending, choose } = useRetroChoice(item);
    const kindOf = useButtonKind();

    return (
        <Inline>
            <Button {...kindOf('open')} disabled={pending} onClick={() => useItemDialogStore.getState().open(item.id)}>
                Choose follow-ups
            </Button>
            <Button {...kindOf('other')} busy={pending} disabled={pending} onClick={() => void choose([])}>
                Dismiss
            </Button>
        </Inline>
    );
}
