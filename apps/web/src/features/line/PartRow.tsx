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
import { figuresOf, opensItem } from './RowDetails';
import { threadText } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import {
    Age,
    AzureFields,
    checksCount,
    hasFigures,
    prChecks,
    SliceBar,
    SliceList,
    StartAfterError,
    StartMessage,
    useShownStatus,
} from '@/features/items';
import {
    ChecksBar,
    QueueAge,
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
    const checks = prChecks(item);
    const slices = item.slices.length;
    const sliceCount = item.slices.filter((x) => x.progress === 'done').length;

    return (
        <StageRowItem item={item.id} picked={isPicked} attention={asksYou} part>
            <RowFirst>
                <RowOpen onOpen={openPart}>
                    <PartIdentity item={item} home={home} />
                </RowOpen>
                <RowMeta onClick={opensItem(item, onOpen)}>
                    {held && <RowBlocked>{state}</RowBlocked>}
                    {showsActivity && <ActivityLine item={item} />}
                    {checks ? (
                        <RowProgress
                            bar={<ChecksBar checks={checks} still={still} />}
                            count={<RowCount title={checksCount(checks)}>{checksCount(checks)}</RowCount>}
                        />
                    ) : (
                        slices > 0 &&
                        !partsCounted && (
                            <RowProgress
                                bar={<SliceBar item={item} still={still} />}
                                count={
                                    <RowSliceToggle
                                        open={unfolded}
                                        label={unfolded ? 'Hide slices' : 'Show slices'}
                                        onToggle={() => setUnfolded(!unfolded)}
                                    >
                                        {`${sliceCount}/${slices} slices done`}
                                    </RowSliceToggle>
                                }
                            />
                        )
                    )}
                    <RowMetaEnd full={full}>
                        <Figures s={figures} item={item} full={full} />
                        {/* A part with nothing else to say at its end says how long it has waited, as a lane row does. */}
                        {(held || showsActivity) && !(figures && hasFigures(figures)) && (
                            <QueueAge>
                                <Age at={item.updatedAt} />
                            </QueueAge>
                        )}
                        {!held &&
                            !showsActivity &&
                            (asksYou ? (
                                <WaitWord>{word}</WaitWord>
                            ) : (
                                <RowState title={threadText(item, shown.working)}>{state}</RowState>
                            ))}
                        <AzureFields azure={item.azure} />
                    </RowMetaEnd>
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
