// The item dialog's footer actions: the one action the item's state asks for, with Open thread beside it, and Move to
// List and Abandon at its left. Stopped work the board can't restart asks to be resumed in T3, as its primary action.

import {
    canResumeShaping,
    canRetryBuild,
    currentBuildThread,
    itemActivityThread,
    needsAnswer,
    nextAction,
} from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { useMovesItem } from './useMovesItem';
import {
    AbandonButton,
    BackToListButton,
    OpenThread,
    PrAction,
    QueueButton,
    StartBuild,
    StartOrAfter,
    hasLiveThread,
    useShownStatus,
} from '@/features/items';
import type { ItemState } from '@/features/items';

/** A status's action: a thread it opens, the latest when `opens` names none, or another control. */
type StatusAction = { opens: string | undefined; label?: string; primary?: boolean } | { control: ReactNode };

const LATEST_THREAD: StatusAction = { opens: undefined };

const latestThread = (item: Item) => (Array.isArray(item.threads) ? item.threads[0]?.id : undefined);

/** The one thing the item's status asks of you. A Start leaves the latest thread to the Open thread beside it. */
function statusAction(item: Item, data: BoardData, { working, resume }: ItemState): StatusAction {
    const linkedBeside = latestThread(item);

    if (resume) return { opens: itemActivityThread(item)?.id, label: 'Resume in T3', primary: true };

    if (working) return { opens: currentBuildThread(item)?.id };

    const action = nextAction(item);

    if (action?.kind === 'thread') return { opens: action.threadId, label: action.label };

    if (action?.kind === 'pr') return { control: <PrAction item={item} label={action.label} primary /> };

    switch (item.status) {
        case 'List':
            return { control: <QueueButton item={item} data={data} /> };
        case 'Queued':
            if (hasLiveThread(item)) return LATEST_THREAD;

            return {
                control: <StartOrAfter item={item} data={data} label="Shape" linkedBeside={linkedBeside} />,
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
        default:
            return { control: null };
    }
}

/** The status's action, with Open thread on the latest thread beside it unless the action already opens that thread. */
export function StatusActions({ item, data }: { item: Item; data: BoardData }) {
    const shown = useShownStatus(item);

    const action = statusAction(item, data, shown);
    const latest = latestThread(item);
    const opensThread = 'opens' in action;
    const beside =
        item.threads === 'unavailable'
            ? !opensThread
            : latest !== undefined && !(opensThread && (action.opens ?? latest) === latest);

    return (
        <>
            {item.kind !== 'concept' && beside && <OpenThread item={item} data={data} />}
            {opensThread
                ? item.kind !== 'concept' && (
                      <OpenThread
                          item={item}
                          data={data}
                          threadId={action.opens}
                          label={action.label}
                          primary={needsAnswer(item) || Boolean(action.primary)}
                      />
                  )
                : action.control}
        </>
    );
}

/** Move to List and Abandon; a Start in flight, uncertain or done, or a thread at work on the item, takes them away. */
export function MoveActions({ item, data }: { item: Item; data: BoardData }) {
    const moves = useMovesItem(item, data);

    if (!moves) return null;

    if (item.status === 'List') return <AbandonButton item={item} data={data} />;

    return (
        <>
            <BackToListButton item={item} data={data} />
            <AbandonButton item={item} data={data} />
        </>
    );
}
