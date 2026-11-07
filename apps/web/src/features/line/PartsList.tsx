// An expanded dossier's parts list: each part with what it asks next, its stage track, figures, thread and slices.

import {
    ACTIVITY_WORD,
    UNREADABLE,
    blockerGroups,
    canRetryBuild,
    currentBuildThread,
    itemName,
    repoKey,
} from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { useState } from 'react';

import { ActivityLine, useActivityState, useActivityStill } from './ActivityLine';
import { Figures, RowSecondLine, figuresOf, opensItem } from './Columns';
import { PartName } from './DossierEntries';
import { open, usePicked, waitsOn } from './DossierHelpers';
import { THREAD_GLYPH, isDone, openWaits, shownThread, threadsOf } from './DossierParts';
import type { Part } from './DossierParts';
import { PartStart } from './PartStart';
import { OnYourDesk, ROW_OPENS, Track, lastSeen, YOURS, picked } from './StageTrack';
import { PartKindLabel } from './WorkMapParts';
import {
    AzureFields,
    RepoCell,
    SliceBar,
    usageLoading,
    usageUnreadable,
    useShownStatus,
    OpenThread,
    StartAfterError,
    StartBuild,
    StartMessage,
    StatusGlyph,
    useStatusActivity,
} from '@/features/items';

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
        <span className="flex min-w-0 items-center gap-1.5" title={thread.title}>
            <StatusGlyph
                status={thread.state === 'running' ? part.item.status : THREAD_GLYPH[thread.state]}
                running={!thread.observedAt && running(part.item)}
                className="size-3"
            />
            <span className="truncate">T3 · {thread.title}</span>
            <span className="shrink-0">
                · {thread.archived ? 'archived' : thread.state}
                {lastSeen(thread)}
            </span>
        </span>
    );
}

/** The one thing a part asks next: on your desk, or its Start (or Start after while it waits). Otherwise its thread,
 *  when it has one, or while its status says one works on it, and what it waits on beside that. */
function Action({ part, data }: { part: Part; data: BoardData }) {
    const { status } = part.item;
    const { working } = useShownStatus(part.item);
    const done = isDone(part.item);

    if (!done && working)
        return <OpenThread item={part.item} data={data} threadId={currentBuildThread(part.item)?.id} />;

    if (!done && YOURS.includes(status)) return <OnYourDesk />;

    if (!done && (status === 'Ready' || status === 'Queued'))
        return <PartStart part={part} data={data} label="Start" />;

    const waiting = !done && openWaits(part).length > 0;

    if (!done && !waiting && canRetryBuild(part.item)) return <StartBuild item={part.item} data={data} />;

    const thread =
        threadsOf(part.item).length > 0 || (!done && !waiting && ['Shaping', 'In progress', 'Review'].includes(status));

    return (
        <>
            {waiting && (
                <span className="max-w-48 truncate" title={waitsOn(part)}>
                    {waitsOn(part)}
                </span>
            )}
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
    const waits = openWaits(part);
    const shown = useShownStatus(item);
    const running = useStatusActivity();
    const s = figuresOf(item, data);
    const activity = useActivityState(item);
    const still = useActivityStill(item);
    const word = (activity && ACTIVITY_WORD[activity]) ?? shown.word;
    const slices = item.slices.length;
    const hasThreadLine = !!activity || !!shownThread(part, shown.working) || waits.length > 0;

    return (
        <li data-part={item.id} className={`@container rounded-md px-3 py-2 hover:bg-(--accent) ${picked(isPicked)}`}>
            <div className="flex items-start gap-x-3">
                <button
                    type="button"
                    data-row-open
                    onClick={() => open(item)}
                    title={itemName(item)}
                    className={`grid min-w-0 flex-1 gap-y-1 rounded text-left ${ROW_OPENS}`}
                >
                    <PartName part={part} />
                    <span
                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs text-(--muted-foreground)"
                        data-part-meta
                    >
                        <PartKindLabel kind={part.kind} />
                        {repoKey(item) !== home && <RepoCell item={item} />}
                        <span className="w-28 shrink-0">
                            <Track
                                status={isDone(item) ? 'Done' : item.status}
                                running={running(item)}
                                label={word}
                                waiting={waits.length > 0}
                            />
                        </span>
                        <span>{isDone(item) ? 'Complete' : word}</span>
                        <AzureFields azure={item.azure} />
                    </span>
                </button>
                <span
                    data-part-action
                    className="flex min-h-7 shrink-0 items-center justify-end gap-2 text-xs text-(--muted-foreground)"
                >
                    <Action part={part} data={data} />
                </span>
            </div>
            {(slices > 0 ||
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
                            <span data-col="count" className="tabular-nums">
                                {item.slices.filter((x) => x.progress === 'done').length}/{slices} slices
                            </span>
                        )
                    }
                >
                    {activity ? <ActivityLine item={item} /> : hasThreadLine && <ThreadLine part={part} />}
                </RowSecondLine>
            )}
            {!isDone(item) && ['Ready', 'Queued', 'In progress'].includes(item.status) && (
                <span className="block pt-1 pl-5 empty:hidden">
                    <StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} />
                    <StartAfterError item={item} data={data} />
                </span>
            )}
        </li>
    );
}

/** The parts list: one row per open part in two columns where there's room, the done ones folded into a count. */
export function PartsList({ parts, data, home }: { parts: Part[]; data: BoardData; home: string }) {
    const [showDone, setShowDone] = useState(false);
    const shown = parts.filter((p) => showDone || !isDone(p.item));
    const done = parts.filter((p) => isDone(p.item)).length;

    return (
        <div className="grid gap-1">
            <ol className="m-0 grid list-none gap-x-4 gap-y-1 p-0 @4xl:grid-cols-2" data-parts-list>
                {shown.map((p) => (
                    <PartRow key={p.item.id} part={p} data={data} home={home} />
                ))}
            </ol>
            {done > 0 && (
                <button
                    type="button"
                    aria-expanded={showDone}
                    onClick={() => setShowDone(!showDone)}
                    className="justify-self-start rounded px-2 py-1 text-[11px] text-(--muted-foreground) hover:bg-(--accent)"
                >
                    {showDone ? `Hide ${done} done` : `Show ${done} done`}
                </button>
            )}
        </div>
    );
}
