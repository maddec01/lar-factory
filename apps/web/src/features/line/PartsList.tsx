// An expanded dossier's parts list: each part with what it asks next, its stage track, figures, thread and slices.

import type { BoardData } from '@lar-factory/shared';
import {
    UNREADABLE,
    retiredPartLabel,
    blockerGroups,
    canRetryBuild,
    currentBuildThread,
    itemName,
    repoKey,
} from '@lar-factory/shared';
import { useState } from 'react';

import { ActivityLine } from './ActivityLine';
import { Figures, RowSecondLine } from './Columns';
import { PartName } from './DossierEntries';
import { open, usePicked, waitsOn } from './DossierHelpers';
import type { Part } from './DossierParts';
import { THREAD_GLYPH, isDone, openWaits, shownThread, threadsOf } from './DossierParts';
import { PartStart } from './PartStart';
import { figuresOf, opensItem } from './RowDetails';
import { YOURS, lastSeen } from './StageStatus';
import { useActivityState, useActivityStill } from './useActivityState';
import { PartKindLabel } from './WorkMapParts';
import {
    conceptBuildWait,
    AzureFields,
    OpenThread,
    RepoCell,
    SliceBar,
    StartAfterError,
    StartBuild,
    StartMessage,
    StatusGlyph,
    usageLoading,
    usageUnreadable,
    useShownStatus,
    useStatusActivity,
} from '@/features/items';
import {
    PartRow as DesignPartRow,
    PartsList as DesignPartsList,
    PartWaits,
    RowCount,
    ShowDoneToggle,
    ThreadLine as DesignThreadLine,
} from '@/ui/board';

/** A part's thread, its title and state; before it has one, what its start waits on. */
function ThreadLine({ part }: { part: Part }) {
    const thread = shownThread(part, useShownStatus(part.item).working);
    const running = useStatusActivity();

    if (!thread) {
        const { work, dependencies } = blockerGroups(part.item, openWaits(part));
        const waits = [
            ...(work ? [work.names] : []),
            ...(dependencies ? [`you to mark ${dependencies.names} met`] : []),
        ];

        return waits.length ? <span>Waiting on {waits.join(' and ')}</span> : null;
    }

    return (
        <DesignThreadLine
            title={thread.title}
            glyph={
                <StatusGlyph
                    status={thread.state === 'running' ? part.item.status : THREAD_GLYPH[thread.state]}
                    running={!thread.observedAt && running(part.item)}
                    size="sm"
                />
            }
            name={`T3 · ${thread.title}`}
            state={`${thread.archived ? 'archived' : thread.state}${lastSeen(thread)}`}
        />
    );
}

/** The one thing a part asks next: its thread when it waits on you, or its Start unless other work holds it. Otherwise
 *  its thread, when it has one, or while its status says one works on it, and what it waits on beside that. */
function Action({ part, data }: { part: Part; data: BoardData }) {
    const { status } = part.item;
    const { working } = useShownStatus(part.item);
    const done = isDone(part.item);

    if (!done && working)
        return <OpenThread item={part.item} data={data} threadId={currentBuildThread(part.item)?.id} />;

    // A part that waits on you opens its thread, as the desk's row does; its row opens its details.
    if (!done && YOURS.includes(status)) return <OpenThread item={part.item} data={data} />;

    // A part held by other work says so in its state and offers no start, as a lane's blocked row.
    if (!done && (status === 'Ready' || status === 'Queued'))
        return openWaits(part).length ? null : <PartStart part={part} data={data} />;

    const waiting = !done && openWaits(part).length > 0;

    if (!done && !waiting && canRetryBuild(part.item)) return <StartBuild item={part.item} data={data} />;

    const thread =
        threadsOf(part.item).length > 0 || (!done && !waiting && ['Shaping', 'In progress', 'Review'].includes(status));

    return (
        <>
            {waiting && <PartWaits>{waitsOn(part)}</PartWaits>}
            {thread && <OpenThread item={part.item} data={data} />}
        </>
    );
}

/** One part of the parts list: one button opens its details from its title, stage track, status and Azure fields; what
 *  it asks next sits beside that button, then a second line of its slice bar and count, thread, PR and agent figures, and
 *  its start's message or error under that. `home` is the dossier's own repository, which needs no naming. */
function PartRow({ part, data, home }: { part: Part; data: BoardData; home: string }) {
    const { item } = part;
    const isPicked = usePicked(item);
    const shown = useShownStatus(item);
    const s = figuresOf(item, data);
    const activity = useActivityState(item);
    const still = useActivityStill(item);
    // The one presenter's word, the same a row and the dialog say for this part.
    const word = shown.word;
    const slices = item.slices.length;
    // Its state already names what it waits on, so the thread line says only what a thread does.
    const hasThreadLine = !!activity || !!shownThread(part, shown.working);

    return (
        <DesignPartRow
            id={item.id}
            picked={isPicked}
            title={itemName(item)}
            onOpen={() => open(item)}
            name={<PartName part={part} />}
            meta={
                <>
                    <PartKindLabel kind={part.kind} />
                    {repoKey(item) !== home && <RepoCell item={item} />}
                    <span>
                        {retiredPartLabel(item) ?? (isDone(item) ? 'Complete' : (conceptBuildWait(item, data) ?? word))}
                    </span>
                    <AzureFields azure={item.azure} />
                </>
            }
            action={<Action part={part} data={data} />}
            second={
                (slices > 0 ||
                    item.linkedPrs.length > 0 ||
                    s ||
                    usageLoading(item, data) ||
                    usageUnreadable(item) ||
                    hasThreadLine) && (
                    <RowSecondLine
                        onClick={opensItem(item)}
                        prs={item.linkedPrs}
                        figures={
                            s || usageLoading(item, data) ? (
                                <Figures s={s} item={item} />
                            ) : (
                                usageUnreadable(item) && UNREADABLE
                            )
                        }
                        bar={slices > 0 && <SliceBar item={item} still={still} />}
                        count={
                            slices > 0 && (
                                <RowCount>
                                    {item.slices.filter((x) => x.progress === 'done').length}/{slices} slices
                                </RowCount>
                            )
                        }
                    >
                        {activity ? <ActivityLine item={item} /> : hasThreadLine && <ThreadLine part={part} />}
                    </RowSecondLine>
                )
            }
            foot={
                !isDone(item) &&
                ['Ready', 'Queued', 'In progress'].includes(item.status) && (
                    <>
                        <StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} />
                        <StartAfterError item={item} data={data} />
                    </>
                )
            }
        />
    );
}

/** The parts list: one row per open part in two columns where there's room, the done ones folded into a count. */
export function PartsList({ parts, data, home }: { parts: Part[]; data: BoardData; home: string }) {
    const [showDone, setShowDone] = useState(false);
    const shown = parts.filter((p) => showDone || !isDone(p.item));
    const done = parts.filter((p) => isDone(p.item)).length;
    const historyName = parts.some((part) => part.item.setAside) ? 'past parts' : 'done';

    return (
        <DesignPartsList
            showDone={
                done > 0 && (
                    <ShowDoneToggle open={showDone} onToggle={() => setShowDone(!showDone)}>
                        {showDone ? `Hide ${done} ${historyName}` : `Show ${done} ${historyName}`}
                    </ShowDoneToggle>
                )
            }
        >
            {shown.map((p) => (
                <PartRow key={p.item.id} part={p} data={data} home={home} />
            ))}
        </DesignPartsList>
    );
}
