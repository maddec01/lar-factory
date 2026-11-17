import { deskWait, startProgressOf, type BoardData, type Item } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';

import { writeState } from './ActionAvailability';
import { StartAgain } from './NeedsYou';
import { OpenThread } from './OpenThread';
import { PrAction } from './PrLink';
import { StartOrAfter } from './StartAfter';
import { StartBuild } from './StartBuild';
import { startItem } from './StartItem';
import { PURPOSE, startOf, useStartStore } from './StartStore';
import { useActivityUnavailable } from './useActivityFeedback';
import { useShownStart } from './useShownStart';
import { useItemDialogStore } from '@/features/item-dialog';
import { notify } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { buttonKind, StartTag } from '@/ui/board';

/** The card's action, and Open thread as a square icon in the right corner unless it is the action. `quiet` draws a
 *  next step outlined, as on Your desk, where its rows' amber bar already says it waits on you. */
export function HumanWaitAction({ item, data, quiet = false }: { item: Item; data: BoardData; quiet?: boolean }) {
    const wait = deskWait(item, useActivityUnavailable(), data.items);
    const { action } = wait;
    // A required verification is done in the dialog, unless a failed check or a conflict comes first.
    const verifies = wait.label === 'Verify build' && !!item.verification?.required;

    if (action?.kind === 'start-again') return <StartAgain item={item} data={data} />;

    if (action?.kind === 'retry-build') return <StartBuild item={item} data={data} />;

    if (action?.kind === 'resume-shaping') return <StartOrAfter item={item} data={data} />;

    if (action?.kind === 'reconcile-group')
        return <ReconcileGroup item={item} data={data} label={action.label} quiet={quiet} />;

    if (verifies || action?.kind === 'details')
        return (
            <Button
                {...buttonKind(quiet ? 'open' : 'next')}
                onClick={() => useItemDialogStore.getState().open(item.id)}
            >
                {action?.kind === 'details' ? action.label : 'Verify build'}
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

/**
 * Starts the group parent's thread to settle the saved checklist; the card then shows that thread as it runs. A failed
 * start offers Retry start and toasts why; one that may have run shows a tag in its place, so it never starts twice.
 */
function ReconcileGroup({ item, data, label, quiet }: { item: Item; data: BoardData; label: string; quiet: boolean }) {
    const { pending, uncertain, error } = useShownStart(item, data, 'refine');

    if (uncertain)
        return (
            <StartTag unsure data-start-result={item.id} title="Check T3 before starting it again">
                May have started
            </StartTag>
        );

    const press = async () => {
        await startItem(item.id);

        const failed = startProgressOf(useBoardStore.getState().data, item.id, PURPOSE.refine);
        const local = startOf(useStartStore.getState(), item.id);
        const message = failed?.phase === 'failed' ? failed.message : local?.phase === 'error' ? local.message : null;

        if (message) notify({ verb: 'Failed', item, reconcile: true, message });
    };

    return (
        <Button
            {...buttonKind(quiet ? 'open' : 'next')}
            busy={pending}
            data-reconcile-group={item.id}
            title={error}
            {...(pending ? { 'aria-disabled': true as const } : writeState(data))}
            onClick={() => !pending && void press()}
        >
            {error ? 'Retry start' : label}
        </Button>
    );
}
