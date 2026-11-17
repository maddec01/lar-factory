import { placementOf } from '@lar-factory/shared';
// The board's one work row, in Queue, Shaping, Ready to build and Build alike: a first line in columns that line up down
// the whole board, one button that opens the item's details with the row's action beside it. A row with anything more adds
// a second line under it, with a bar and the slice count, which unfolds its slices, as its own focus stop, then any blocked
// sentence and what its thread is doing or its first blocked or active slice, then its pull request and figures.
import type { BoardData, Item, Status } from '@lar-factory/shared';
import {
    blockedText,
    canRetryBuild,
    currentBuildThread,
    itemActivityThread,
    itemName,
    openBlockers,
} from '@lar-factory/shared';
import { useState } from 'react';

import { ActivityLine } from './ActivityLine';
import { AutoBuildNote } from './AutoBuildNote';
import { Figures } from './Columns';
import { ChecksProgress } from './RowChecks';
import { figuresOf, opensItem } from './RowDetails';
import { RowKindMark, RowSource } from './RowIdentity';
import type { StageRow as Row } from './StageRows';
import { YOURS, threadText } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import { workLabel } from './WorkLabel';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    Age,
    ItemStatusGlyph,
    ItemTitle,
    SLOT_WAIT,
    OpenThread,
    SliceBar,
    WorkingBar,
    SliceList,
    StartAfterError,
    StartBuild,
    StartMessage,
    StartOrAfter,
    hasLiveThread,
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
    VerifyEvidence,
    WaitWord,
    RowCount,
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

/** The blocked slices, then the active ones. */
const sliceNote = (item: Item) => {
    const b = item.slices.filter((s) => s.progress === 'blocked');
    const a = item.slices.filter((s) => s.progress === 'active');

    return [
        ...b.map((s) => ({ s, word: 'blocked', tone: 'blocked' as const })),
        ...a.map((s) => ({ s, word: 'working', tone: 'active' as const })),
    ];
};

/** The slice note: the first blocked slice by name, so the row says what's stuck, then how many more are blocked and
 *  how many work, in counts that can't be misread ("Bandwidth probe blocked · 2 working"); every name in the tooltip. */
const sliceCounts = (note: ReturnType<typeof sliceNote>) => {
    const blocked = note.filter((n) => n.tone === 'blocked').length;
    const working = note.length - blocked;
    const rest = [blocked > 1 && `${blocked - 1} more blocked`, working > 0 && `${working} working`].filter(Boolean);

    return { name: note[0]!.s.title, more: rest.length ? ` · ${rest.join(' · ')}` : undefined };
};

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
    // A row whose item is on Your desk waits on you, wherever it sits on the board.
    const yours = placementOf(item, {
        starts: data.startProgress?.[item.id],
        unavailable,
        all: data.items,
    }).sections.includes('desk');
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
                        <RowSource item={item} always />
                        <RowKindMark item={item} />
                        <RowTitle name={itemName(item)}>
                            <ItemTitle item={item} />
                        </RowTitle>
                    </RowTitleCell>
                </RowOpen>
                <RowMeta onClick={opensItem(item)}>
                    {/* What is going on, in one column: what its thread does now, else its state, else what holds it,
                        else its first blocked or working slice. */}
                    {showsActivity ? (
                        <ActivityLine item={item} />
                    ) : endState && yours ? (
                        // What waits on you reads in the desk's amber here too, so it catches the eye on any lane.
                        <RowState title={endState}>
                            <WaitWord>{endState}</WaitWord>
                            {activity === 'working' && <ActivityLine item={item} />}
                        </RowState>
                    ) : endState ? (
                        <RowState
                            title={[(shown.light || shown.blocked) && shown.recorded, threadText(item, shown.working)]
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
                    {checks ? (
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
                    {item.status === 'In progress' && item.verification?.latest?.result === 'fail' && (
                        <VerifyEvidence>Fixing failed Verify: {item.verification.latest.note}</VerifyEvidence>
                    )}
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
