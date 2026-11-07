// The board's one work row, in Queue, Shaping, Ready to build and Build alike: a first line in columns that line up down
// the whole board, one button that opens the item's details with the row's action beside it. A row with anything more adds
// a second line under it, with a bar and the slice count, which unfolds its slices, as its own focus stop, then any blocked
// sentence and what its thread is doing or its first blocked or active slice, then its pull request and figures.

import { ACTIVITY_WORD, blockedText, canRetryBuild, currentBuildThread, itemName } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import {
    QueueAge,
    QueuePlace,
    RowBlocked,
    RowFirst,
    RowFoot,
    RowGlyph,
    RowKindCell,
    RowOpen,
    RowPartOf,
    RowSide,
    RowSliceNote,
    RowSliceToggle,
    RowSlices,
    RowState,
    RowStateCell,
    RowTitle,
    RowTitleCell,
    StageRowItem,
} from '@lar-works/design-system';
import { useState } from 'react';

import { ActivityLine, useActivityState, useActivityStill } from './ActivityLine';
import { AutoBuildNote } from './AutoBuildNote';
import { Figures, RowSecondLine, figuresOf, opensItem } from './Columns';
import { threadAtWork, threadsOf } from './DossierParts';
import { RowKind, RowSource } from './RowIdentity';
import type { StageRow as Row } from './StageRows';
import { OnYourDesk, YOURS, threadText } from './StageTrack';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    ActivityFeedback,
    Age,
    AzureFields,
    ItemTitle,
    KindMarker,
    SliceBar,
    SliceList,
    hasFigures,
    usageLoading,
    useActivityFeedback,
    useActivityUnavailable,
    useShownStatus,
    OpenThread,
    hasLiveThread,
    StartAfterError,
    StartOrAfter,
    StartBuild,
    StartMessage,
    ItemStatusGlyph,
} from '@/features/items';

/** The one thing a status asks next, or where to act on an item that waits on you. */
function Side({ item, data }: { item: Item; data: BoardData }) {
    const { working } = useShownStatus(item);

    if (working) return <OpenThread item={item} data={data} threadId={currentBuildThread(item)?.id} />;

    if (YOURS.includes(item.status)) return <OnYourDesk />;

    switch (item.status) {
        case 'Queued':
            return hasLiveThread(item) ? (
                <OpenThread item={item} data={data} />
            ) : (
                <StartOrAfter item={item} data={data} label="Shape" namesBlocker={false} />
            );
        case 'Ready':
            return <StartBuild item={item} data={data} namesBlocker={false} />;
        case 'In progress':
            if (canRetryBuild(item)) return <StartBuild item={item} data={data} namesBlocker={false} />;

            return <OpenThread item={item} data={data} />;
        case 'Shaping':
        case 'Review':
            return <OpenThread item={item} data={data} />;
        default:
            return null;
    }
}

/** The blocked slices, then the active ones. */
const sliceNote = (item: Item) => {
    const b = item.slices.filter((s) => s.progress === 'blocked');
    const a = item.slices.filter((s) => s.progress === 'active');

    return [
        ...b.map((s) => ({ s, word: 'blocked', tone: 'blocked' as const })),
        ...a.map((s) => ({ s, word: 'active', tone: 'active' as const })),
    ];
};

/** Which concept or parent the row's work belongs to. */
function PartOf({ concept }: { concept: Item }) {
    const text = `${concept.kind === 'concept' ? 'Concept' : 'Part of'}: ${concept.title}`;

    return <RowPartOf>{text}</RowPartOf>;
}

/** The row's state, once: Working for a run known to be running, whatever telemetry it lacks; a running build's phase; a start's progress only where nothing else on the row says it. */
function stateText(
    item: Item,
    word: string,
    { label, running }: { label: string; running: boolean },
    runKnown: boolean,
): string {
    if (label === 'Activity unavailable') return runKnown ? 'Working' : word;

    if (label === word || label === 'Working') return label;

    if (running) return label;

    if (
        (label === 'Starting' || label === 'May have started') &&
        ['Queued', 'Ready', 'In progress'].includes(item.status)
    )
        return word;

    return `${word} · ${label}`;
}

/** `n` is a Queue row's place in the Queue, which it shows in the glyph's place, with its age as its state. */
export function StageRow({ row: { item, concept }, data, n }: { row: Row; data: BoardData; n?: number }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const unavailable = useActivityUnavailable();
    const [slices, setSlices] = useState(false);
    const isPicked = useItemDialogStore((state) => state.itemId === item.id);
    const done = item.slices.filter((s) => s.progress === 'done').length;
    const implemented = item.slices.length > 0 && done === item.slices.length;
    const note = sliceNote(item);
    const blocked = blockedText(item);
    const runKnown =
        (!unavailable || activity === 'working') && activity !== 'unavailable' && threadsOf(item).some(threadAtWork);
    const state =
        (activity && ACTIVITY_WORD[activity]) ??
        (shown.working ? 'Working' : stateText(item, shown.word, feedback, runKnown));
    const still = useActivityStill(item);
    const working = !still && (feedback.running || state === 'Working');
    const showsActivity = n === undefined && activity;
    const figures = figuresOf(item, data);
    const prs = item.linkedPrs.slice(0, 1);
    const hasSecondLine =
        item.slices.length > 0 ||
        working ||
        showsActivity ||
        prs.length > 0 ||
        (figures && hasFigures(figures)) ||
        usageLoading(item, data) ||
        blocked;

    return (
        <StageRowItem item={item.id} picked={isPicked}>
            <RowFirst>
                <RowOpen onOpen={() => useItemDialogStore.getState().open(item.id)}>
                    {n === undefined ? (
                        <RowGlyph>
                            <ItemStatusGlyph item={item} />
                        </RowGlyph>
                    ) : (
                        <QueuePlace>{n + 1}</QueuePlace>
                    )}
                    <RowSource item={item} />
                    <RowKindCell>
                        <RowKind item={item} />
                    </RowKindCell>
                    <RowTitleCell>
                        <RowTitle name={itemName(item)}>
                            <ItemTitle item={item} />
                        </RowTitle>
                        {concept && <PartOf concept={concept} />}
                    </RowTitleCell>
                    <RowStateCell>
                        {n === undefined ? (
                            <RowState title={threadText(item, shown.working)}>{state}</RowState>
                        ) : (
                            <QueueAge>
                                <Age at={item.updatedAt} />
                            </QueueAge>
                        )}
                        <KindMarker item={item} />
                        <AzureFields azure={item.azure} />
                    </RowStateCell>
                </RowOpen>
                <RowSide>
                    <Side item={item} data={data} />
                </RowSide>
            </RowFirst>
            {hasSecondLine && (
                <RowSecondLine
                    onClick={opensItem(item)}
                    prs={prs}
                    figures={<Figures s={figures} item={item} />}
                    bar={
                        item.slices.length > 0 ? (
                            <SliceBar item={item} still={still} />
                        ) : (
                            working && <ActivityFeedback feedback={{ ...feedback, running: true }} />
                        )
                    }
                    count={
                        item.slices.length > 0 && (
                            <RowSliceToggle
                                open={slices}
                                label={slices ? 'Hide slices' : 'Show slices'}
                                onToggle={() => setSlices(!slices)}
                            >
                                {done}/{item.slices.length} slices
                            </RowSliceToggle>
                        )
                    }
                >
                    {blocked && <RowBlocked>{blocked}</RowBlocked>}
                    {showsActivity ? (
                        <ActivityLine item={item} />
                    ) : (
                        (note[0] || implemented) && (
                            <RowSliceNote
                                title={note.map(({ s, word }) => `${word} ${itemName(s)}`).join('\n') || undefined}
                                first={note[0] && { word: note[0].word, tone: note[0].tone, title: note[0].s.title }}
                                more={note.length > 1 ? ` +${note.length - 1} more` : undefined}
                                after={implemented ? 'All slices implemented' : undefined}
                            />
                        )
                    )}
                </RowSecondLine>
            )}
            {['Queued', 'Ready', 'In progress'].includes(item.status) && (
                <RowFoot>
                    <StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} />
                    <StartAfterError item={item} data={data} />
                    <AutoBuildNote item={item} data={data} />
                </RowFoot>
            )}
            {slices && (
                <RowSlices>
                    <SliceList item={item} still={still} />
                </RowSlices>
            )}
        </StageRowItem>
    );
}
