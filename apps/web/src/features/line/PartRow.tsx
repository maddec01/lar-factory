// One part of a concept as a lane row, the same in the board's parts box and in the concept's dialog: what it is,
// what holds it or what its thread does, its checks or slices, its cost or state, and what it asks next.

import type { BoardData } from '@lar-factory/shared';
import { needsAnswer } from '@lar-factory/shared';
import { useState } from 'react';

import { ActivityLine } from './ActivityLine';
import { Figures } from './Columns';
import { open, usePicked } from './DossierHelpers';
import type { Part } from './DossierParts';
import { isDone, openWaits } from './DossierParts';
import { PartAction } from './PartAction';
import { PartIdentity } from './PartIdentity';
import { partState } from './PartState';
import { ChecksProgress } from './RowChecks';
import { figuresOf, opensItem } from './RowDetails';
import { threadText } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import { workLabel } from './WorkLabel';
import {
    Age,
    prChecks,
    SliceBar,
    WorkingBar,
    SliceList,
    StartAfterError,
    StartMessage,
    useShownStatus,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    RowBlocked,
    RowCount,
    RowFirst,
    RowFoot,
    RowMeta,
    RowMetaEnd,
    RowOpen,
    RowProgress,
    RowSide,
    RowSlices,
    RowSliceToggle,
    RowState,
    StageRowItem,
    WaitWord,
} from '@/ui/board';

/** One part of a concept, on the board and in the concept's dialog alike, as a lane row reads: its state glyph, kind
 *  and source marks, its number and title and its project on one line; then what holds it or what its thread does now,
 *  its checks or slices bar and count (which unfold its slices), and its cost or state at the end, with what it asks
 *  next over them on hover. `home` is the concept's own repository, which a part in it names quietly. */
export function PartRow({
    part,
    data,
    home,
    onOpen,
    full = false,
}: {
    part: Part;
    data: BoardData;
    home: string | undefined;
    /** Opens the part in place of the item dialog's own open, as the concept's dialog does. */
    onOpen?: (() => void) | undefined;
    /** Every agent figure at its end, "2h 29m · 64.8M tokens · $29.12", as the concept's dialog has room for. */
    full?: boolean;
}) {
    const { item } = part;
    const openPart = onOpen ?? (() => open(item));
    const isPicked = usePicked(item);
    const disconnected = useBoardStore((state) => !!state.clientError);
    const shown = useShownStatus(item);
    const activity = useActivityState(item);
    const still = useActivityStill(item);
    const [unfolded, setUnfolded] = useState(false);
    const done = isDone(item);
    const word = shown.word;
    // A part whose word already counts its parts shows that one count, not its slices too.
    const partsCounted = word.endsWith(' parts done');
    // A part that waits on you says so in amber, as its desk card does.
    const asksYou = !done && (needsAnswer(item) || item.status === 'Needs you');
    // What holds a part reads where its activity would, as a lane row's blocker does: "Blocked by #139".
    const held = !done && openWaits(part).length > 0;
    const state = partState(item, data, word);
    const showsActivity = !held && activity && !['unavailable', 'stopped', 'waiting'].includes(activity);
    const figures = figuresOf(item, data);
    const checks = prChecks(item, data, disconnected);
    const slices = item.slices.length;
    const sliceCount = item.slices.filter((x) => x.progress === 'done').length;
    // A part at work names what runs, so its bar says something is going on even with no slices to count.
    // A thread paused on you (a question, an approval) keeps its bar, its light travelling in amber.
    const waiting = activity === 'waiting';
    const atWork = done || held ? undefined : workLabel(item, !!showsActivity, waiting);

    return (
        <StageRowItem item={item.id} picked={isPicked} attention={asksYou} part>
            <RowFirst>
                <RowOpen onOpen={openPart}>
                    <PartIdentity item={item} home={home} />
                </RowOpen>
                <RowMeta onClick={opensItem(item, onOpen)}>
                    {/* What is going on, in one column, as a lane row reads: what its thread does, else what it asks of
                        you, else its state, else what holds it. */}
                    {showsActivity ? (
                        <ActivityLine item={item} />
                    ) : asksYou ? (
                        <RowState title={word}>
                            <WaitWord>{word}</WaitWord>
                        </RowState>
                    ) : held ? (
                        <RowBlocked>{state}</RowBlocked>
                    ) : (
                        <RowState title={threadText(item, shown.working)}>{state}</RowState>
                    )}
                    {checks ? (
                        <ChecksProgress {...checks} still={still} />
                    ) : slices > 0 && !partsCounted ? (
                        <RowProgress
                            bar={<SliceBar item={item} still={still} />}
                            count={
                                <RowSliceToggle
                                    open={unfolded}
                                    label={unfolded ? 'Hide slices' : 'Show slices'}
                                    onToggle={() => setUnfolded(!unfolded)}
                                >
                                    {`${sliceCount}/${slices} slices`}
                                </RowSliceToggle>
                            }
                        />
                    ) : (
                        atWork && (
                            <RowProgress
                                bar={<WorkingBar label={atWork} still={still} waiting={waiting} />}
                                count={<RowCount title={atWork}>{atWork}</RowCount>}
                            />
                        )
                    )}
                    <RowMetaEnd
                        full={full}
                        cost={<Figures s={figures} item={item} full={full} />}
                        age={!done && <Age at={item.updatedAt} />}
                    />
                </RowMeta>
                <RowSide>
                    {/* The same action as its Work map card, so switching views never changes what a part offers. */}
                    <PartAction part={part} data={data} />
                </RowSide>
            </RowFirst>
            {!done && ['Ready', 'Queued', 'In progress'].includes(item.status) && (
                <RowFoot>
                    <StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} />
                    <StartAfterError item={item} data={data} />
                </RowFoot>
            )}
            {unfolded && (
                <RowSlices>
                    <SliceList item={item} still={still} />
                </RowSlices>
            )}
        </StageRowItem>
    );
}
