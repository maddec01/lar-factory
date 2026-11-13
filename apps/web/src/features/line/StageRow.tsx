import { itemRepoNames } from '@lar-factory/shared';
// The board's one work row, in Queue, Shaping, Ready to build and Build alike: a first line in columns that line up down
// the whole board, one button that opens the item's details with the row's action beside it. A row with anything more adds
// a second line under it, with a bar and the slice count, which unfolds its slices, as its own focus stop, then any blocked
// sentence and what its thread is doing or its first blocked or active slice, then its pull request and figures.
import type { BoardData, Item, Status } from '@lar-factory/shared';
import { blockedText, canRetryBuild, currentBuildThread, itemActivityThread, itemName } from '@lar-factory/shared';
import { useState } from 'react';

import { ActivityLine } from './ActivityLine';
import { AutoBuildNote } from './AutoBuildNote';
import { Figures, RowSecondLine } from './Columns';
import { figuresOf, opensItem } from './RowDetails';
import { RowKind, RowSource } from './RowIdentity';
import type { StageRow as Row } from './StageRows';
import { YOURS, threadText } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    ActivityFeedback,
    Age,
    AzureFields,
    ItemStatusGlyph,
    ItemTitle,
    OpenThread,
    SliceBar,
    SliceList,
    StartAfterError,
    StartBuild,
    StartMessage,
    StartOrAfter,
    hasFigures,
    hasLiveThread,
    usageLoading,
    usageUnreadable,
    useActivityFeedback,
    useShownStatus,
} from '@/features/items';
import {
    QueueAge,
    QueuePlace,
    RowBlocked,
    RowFirst,
    RowFoot,
    RowGlyph,
    RowKindCell,
    RowOpen,
    RowSide,
    RowSliceNote,
    RowSlices,
    RowSliceToggle,
    RowState,
    RowStateCell,
    RowTitle,
    RowTitleCell,
    StageRowItem,
} from '@/ui/board';

/** The one thing a status asks next, or where to act on an item that waits on you. */
function Side({ item, data }: { item: Item; data: BoardData }) {
    const { working, resume } = useShownStatus(item);

    if (resume)
        // Tinted like the other starts: resuming is the thing you can do now.
        return <OpenThread item={item} data={data} threadId={itemActivityThread(item)?.id} label="Resume in T3" next />;

    if (working) return <OpenThread item={item} data={data} threadId={currentBuildThread(item)?.id} />;

    if (YOURS.includes(item.status)) return null;

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

/** The stages a board section is named for: Shaping, Ready to build and Build. */
const NAMED_BY_SECTION: readonly Status[] = ['Shaping', 'Ready', 'In progress'];

/** `n` is a Queue row's place in the Queue, which it shows in the glyph's place, with its age as its state. */
export function StageRow({ row: { item }, data, n }: { row: Row; data: BoardData; n?: number }) {
    const feedback = useActivityFeedback(item);
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const [slices, setSlices] = useState(false);
    const isPicked = useItemDialogStore((state) => state.itemId === item.id);
    const done = item.slices.filter((s) => s.progress === 'done').length;
    const implemented = item.slices.length > 0 && done === item.slices.length;
    const note = sliceNote(item);
    const blocked = blockedText(item);
    // A section's heading names its own stage, so a row there says its state only when it says something more.
    const state =
        item.kind !== 'concept' && shown.word === item.status && NAMED_BY_SECTION.includes(item.status)
            ? ''
            : shown.word;
    const still = useActivityStill(item);
    const working = !still && (feedback.running || shown.running);
    const showsActivity =
        n === undefined && activity && activity !== 'unavailable' && activity !== 'stopped' && activity !== 'waiting';
    const figures = figuresOf(item, data);
    const prs = item.linkedPrs.slice(0, 1);
    // Usage T3 couldn't read says so, rather than leave the cell empty as if there were none.
    const hasFigureCell = Boolean(
        (figures && hasFigures(figures)) || usageLoading(item, data) || usageUnreadable(item),
    );
    const hasSecondLine =
        hasFigureCell ||
        item.slices.length > 0 ||
        working ||
        showsActivity ||
        prs.length > 0 ||
        Boolean(blocked) ||
        shown.light;

    return (
        <StageRowItem item={item.id} picked={isPicked}>
            <RowFirst>
                <RowOpen
                    repository={itemRepoNames(item, data.repos)}
                    onOpen={() => useItemDialogStore.getState().open(item.id)}
                >
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
                    </RowTitleCell>
                    <RowStateCell>
                        {n === undefined ? (
                            <RowState
                                title={[
                                    (shown.light || shown.blocked) && state,
                                    (shown.light || shown.blocked) && shown.recorded,
                                    threadText(item, shown.working),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            >
                                {state}
                            </RowState>
                        ) : (
                            <QueueAge>
                                <Age at={item.updatedAt} />
                            </QueueAge>
                        )}
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
                    {/* The section names the recorded stage (and the state's title repeats it); a blocked row's state
                        already says what it starts after. */}
                    {blocked && !shown.blocked && <RowBlocked>{blocked}</RowBlocked>}
                    {showsActivity ? (
                        <ActivityLine item={item} />
                    ) : (
                        !blocked &&
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
