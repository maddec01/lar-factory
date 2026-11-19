// The board's one work row, in Queue, Shaping, Ready to build and Build alike: one line in columns that line up down the
// whole board, one button that opens the item's details with the row's action beside it. Its state cell is a mark and a
// short word, never wrapping, with the detail in its tooltip; its progress cell a tick meter and a count, which unfolds
// its slices, or its reviewers while a review round runs, under the row.
import type { BoardData, Status } from '@lar-factory/shared';
import { blockedText, humanWait, itemName } from '@lar-factory/shared';
import { useState } from 'react';

import { ActivityLine } from './ActivityLine';
import { AutoBuildNote } from './AutoBuildNote';
import { Figures } from './Columns';
import { ChecksProgress } from './RowChecks';
import { figuresOf, opensItem, sliceCounts, sliceNote } from './RowDetails';
import { RowKindMark, RowSource } from './RowIdentity';
import { ReviewerList, ReviewersProgress } from './RowReviewers';
import { Side } from './RowSide';
import type { StageRow as Row } from './StageRows';
import { failedVerifyNote, reviewing, stateMark, threadText } from './StageStatus';
import { useActivityAction, useActivityState, useActivityStill } from './useActivityState';
import { workLabel } from './WorkLabel';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    Age,
    ItemStatusGlyph,
    ItemTitle,
    SLOT_WAIT,
    SliceBar,
    WorkingBar,
    SliceList,
    StartAfterError,
    StartMessage,
    useActivityUnavailable,
    useShownStatus,
    prChecks,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    QueuePlace,
    RowBlocked,
    RowFirst,
    RowFoot,
    RowGlyph,
    RowOpen,
    RowMeta,
    RowMetaEnd,
    RowProgress,
    RowSide,
    RowSliceNote,
    RowSlices,
    RowSliceToggle,
    RowState,
    RowTitle,
    RowTitleCell,
    StageRowItem,
    WaitWord,
    RowCount,
} from '@/ui/board';

/** The stages a board section is named for: Shaping, Ready to build and Build. */
const NAMED_BY_SECTION: readonly Status[] = ['Shaping', 'Ready', 'In progress'];

/** `n` is a Queue row's place in the Queue, which it shows in the glyph's place, with its age as its state. */
export function StageRow({ row: { item }, data, n }: { row: Row; data: BoardData; n?: number }) {
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const [slices, setSlices] = useState(false);
    const isPicked = useItemDialogStore((state) => state.itemId === item.id);
    const disconnected = useBoardStore((state) => !!state.clientError);
    const unavailable = useActivityUnavailable();
    // A row whose item is on Your desk waits on you, wherever it sits on the board: the desk's own decision and words.
    const wait = humanWait(item, unavailable, data.items);
    const yours = !!wait;
    const action = useActivityAction(item);
    const done = item.slices.filter((s) => s.progress === 'done').length;
    const note = sliceNote(item);
    const blocked = blockedText(item);
    // A section's heading names its own stage, so a row there says its state only when it says something more.
    // Ready's heading says once when no build slot is free, so its rows don't each repeat it.
    const state =
        (item.kind !== 'concept' && shown.word === item.status && NAMED_BY_SECTION.includes(item.status)) ||
        shown.word === SLOT_WAIT
            ? ''
            : shown.word;
    const still = useActivityStill(item);
    const failedVerify = failedVerifyNote(item);
    // While a review round runs, its reviewers take the progress cell and unfold under the row as slices do.
    const reviewers = n === undefined && reviewing(item);
    const showsActivity =
        !yours &&
        n === undefined &&
        activity &&
        activity !== 'unavailable' &&
        activity !== 'stopped' &&
        activity !== 'waiting';
    const figures = figuresOf(item, data);
    const checks = prChecks(item, data, disconnected);
    // A row at work names what runs, so its bar says something is going on even with no slices to count.
    // A thread paused on you (a question, an approval) keeps its bar, its light travelling in amber.
    const waiting = activity === 'waiting';
    const atWork =
        n !== undefined ? undefined : workLabel(item, activity === 'working' || activity === 'quiet', waiting);
    const held = shown.blocked ? state : blocked && !shown.blocked ? blocked : '';
    // The checks' count already says how the pipeline stands, so a state about the checks would say it twice.
    // A Queue row's heading says Queued, so it says no state of its own.
    const endState = n !== undefined || shown.blocked || (checks && state.startsWith('Checks ')) ? '' : state;

    // The lane's heading already shows its stage's glyph, so a row draws its own only when it says more: running work,
    // a light, a held or stopped state, or a wait on you.
    const plainGlyph =
        !yours && !shown.light && !shown.running && !shown.glyphState && NAMED_BY_SECTION.includes(shown.glyph);

    return (
        <StageRowItem item={item.id} picked={isPicked} attention={yours}>
            <RowFirst>
                <RowOpen onOpen={() => useItemDialogStore.getState().open(item.id)}>
                    {n === undefined ? (
                        <RowGlyph>{!plainGlyph && <ItemStatusGlyph item={item} />}</RowGlyph>
                    ) : (
                        <QueuePlace>{n + 1}</QueuePlace>
                    )}
                    <RowTitleCell>
                        {/* Where it lives (source and project), then what it is: its kind, number and title. */}
                        <RowSource item={item} />
                        <RowKindMark item={item} />
                        <RowTitle name={itemName(item)}>
                            <ItemTitle item={item} />
                        </RowTitle>
                    </RowTitleCell>
                </RowOpen>
                <RowMeta onClick={opensItem(item)}>
                    {/* What is going on, in one column: what its thread does now, else its state, else what holds it,
                        else its first blocked or working slice. */}
                    {wait ? (
                        // What the desk asks of you leads, in its amber and words, over a thread still at work (a
                        // brief gate while its shaping thread writes on), which its tooltip says.
                        <RowState
                            title={[wait.label, shown.prStatus !== wait.label && shown.prStatus, action, failedVerify]
                                .filter(Boolean)
                                .join(' · ')}
                            mark="waiting"
                        >
                            <WaitWord>{wait.label}</WaitWord>
                        </RowState>
                    ) : showsActivity ? (
                        <ActivityLine
                            item={item}
                            word={shown.prStatus ?? (failedVerify && 'Fixing failed Verify')}
                            detail={failedVerify}
                        />
                    ) : endState ? (
                        <RowState
                            mark={stateMark(activity)}
                            title={[
                                (shown.light || shown.blocked) && shown.recorded,
                                threadText(item, shown.working),
                                failedVerify,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        >
                            {endState}
                        </RowState>
                    ) : held ? (
                        <RowBlocked>{held}</RowBlocked>
                    ) : (
                        note[0] && (
                            <RowSliceNote
                                title={note.map(({ s, word }) => `${word} ${itemName(s)}`).join('\n') || undefined}
                                first={{ word: note[0].word, tone: note[0].tone, title: sliceCounts(note).name }}
                                more={sliceCounts(note).more}
                            />
                        )
                    )}
                    {reviewers ? (
                        <ReviewersProgress
                            item={item}
                            open={slices}
                            onToggle={() => setSlices(!slices)}
                            still={still}
                        />
                    ) : checks ? (
                        // An open PR's checks are what move, so they take the slices' place.
                        <ChecksProgress {...checks} still={still} />
                    ) : item.slices.length > 0 ? (
                        <RowProgress
                            bar={<SliceBar item={item} still={still} />}
                            count={
                                <RowSliceToggle
                                    open={slices}
                                    label={slices ? 'Hide slices' : 'Show slices'}
                                    onToggle={() => setSlices(!slices)}
                                >
                                    {`${done}/${item.slices.length} slices`}
                                </RowSliceToggle>
                            }
                        />
                    ) : (
                        // Work at it with no slices to count still draws its bar, so a row at work always shows it.
                        atWork && (
                            <RowProgress
                                bar={<WorkingBar label={atWork} still={still} waiting={waiting} />}
                                count={<RowCount title={atWork}>{atWork}</RowCount>}
                            />
                        )
                    )}
                    <RowMetaEnd
                        cost={n === undefined && <Figures s={figures} item={item} />}
                        age={
                            // A Queue row's age is the item's own, since it was added; its last change is often only
                            // a sync's, the same for every row. The board keeps no time it was queued.
                            n === undefined ? (
                                <Age at={item.updatedAt} />
                            ) : (
                                <Age
                                    at={item.createdAt ?? item.updatedAt}
                                    says={item.createdAt ? 'Added' : 'Changed'}
                                />
                            )
                        }
                    />
                </RowMeta>
                <RowSide>
                    <Side item={item} data={data} />
                </RowSide>
            </RowFirst>
            {['Queued', 'Ready', 'In progress'].includes(item.status) && (
                <RowFoot>
                    <StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} />
                    <StartAfterError item={item} data={data} />
                    <AutoBuildNote item={item} data={data} />
                </RowFoot>
            )}
            {slices && (
                <RowSlices>
                    {reviewers ? <ReviewerList item={item} still={still} /> : <SliceList item={item} still={still} />}
                </RowSlices>
            )}
        </StageRowItem>
    );
}
