// The item dialog's footer actions: the one action the item's status asks for, with Open thread beside it, and Move to
// List and Abandon at its left.

import {
    canResumeShaping,
    canRetryBuild,
    currentBuildThread,
    needsAnswer,
    openQuestionThread,
} from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import {
    AbandonButton,
    BackToListButton,
    OpenThread,
    PrLink,
    QueueButton,
    StartBuild,
    StartOrAfter,
    hasLiveThread,
    useShownStatus,
    useStartHolds,
} from '@/features/items';

/** A status's action: a thread it opens, the latest when `opens` names none, or another control. */
type StatusAction = { opens: string | undefined; label?: string } | { control: ReactNode };

const LATEST_THREAD: StatusAction = { opens: undefined };

const latestThread = (item: Item) => (Array.isArray(item.threads) ? item.threads[0]?.id : undefined);

/** The one thing the item's status asks of you. A Start leaves the latest thread to the Open thread beside it. */
function statusAction(item: Item, data: BoardData, working: boolean): StatusAction {
    const linkedBeside = latestThread(item);

    if (working) return { opens: currentBuildThread(item)?.id };

    if (needsAnswer(item)) return { opens: openQuestionThread(item)?.id, label: 'Answer in T3' };

    switch (item.status) {
        case 'List':
            return { control: <QueueButton item={item} data={data} /> };
        case 'Queued':
            if (hasLiveThread(item)) return LATEST_THREAD;

            return {
                control: <StartOrAfter item={item} data={data} label="Shape issue" linkedBeside={linkedBeside} />,
            };
        case 'Ready':
            return hasLiveThread(item)
                ? LATEST_THREAD
                : { control: <StartBuild item={item} data={data} linkedBeside={linkedBeside} /> };
        case 'Shaping':
            return canResumeShaping(item)
                ? {
                      control: (
                          <StartOrAfter item={item} data={data} label="Resume shaping" linkedBeside={linkedBeside} />
                      ),
                  }
                : LATEST_THREAD;
        case 'In progress':
            return canRetryBuild(item)
                ? { control: <StartBuild item={item} data={data} linkedBeside={linkedBeside} /> }
                : LATEST_THREAD;
        case 'Review':
            return LATEST_THREAD;
        case 'Verify':
            return { control: <PrLink item={item} label="Verify build" /> };
        case 'Ready to merge':
            return { control: <PrLink item={item} label="Merge PR" /> };
        default:
            return { control: null };
    }
}

/** The status's action, with Open thread on the latest thread beside it unless the action already opens that thread. */
export function StatusActions({ item, data }: { item: Item; data: BoardData }) {
    const { working } = useShownStatus(item);
    const action = statusAction(item, data, working);
    const latest = latestThread(item);
    const opensThread = 'opens' in action;
    const beside =
        item.threads === 'unavailable'
            ? !opensThread
            : latest !== undefined && !(opensThread && (action.opens ?? latest) === latest);

    return (
        <>
            {beside && <OpenThread item={item} data={data} />}
            {opensThread ? (
                <OpenThread item={item} data={data} threadId={action.opens} label={action.label} />
            ) : (
                action.control
            )}
        </>
    );
}

/** Move to List and Abandon; a Start in flight, uncertain or done, or a thread at work on the item, takes them away. */
export function MoveActions({ item, data }: { item: Item; data: BoardData }) {
    const startHolds = useStartHolds(item, data);

    if (item.status === 'List') return <AbandonButton item={item} data={data} />;

    if (item.status !== 'Queued' || startHolds || hasLiveThread(item)) return null;

    return (
        <>
            <BackToListButton item={item} data={data} />
            <AbandonButton item={item} data={data} />
        </>
    );
}
