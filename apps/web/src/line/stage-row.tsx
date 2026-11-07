// The board's one work row, in Queue, Shaping, Ready to build and Build alike: a first line in columns that line up down
// the whole board, one button that opens the item's details with the row's action beside it. A row with anything more adds
// a second line under it, with a bar and the slice count, which unfolds its slices, as its own focus stop, then any blocked
// sentence and what its thread is doing or its first blocked or active slice, then its pull request and figures.

import { ACTIVITY_WORD, blockedText, canRetryBuild, currentBuildThread, itemName } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import { ChevronDown, ChevronRight } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
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
} from '../items/item-parts.tsx';
import { OpenThread, hasLiveThread } from '../items/open-thread.tsx';
import { StartAfterError, StartOrAfter } from '../items/start-after.tsx';
import { StartBuild } from '../items/start-build.tsx';
import { StartMessage } from '../items/start-control.tsx';
import { ItemStatusGlyph } from '../items/status-glyph.tsx';
import { ActivityLine, useActivityState, useActivityStill } from './activity-line.tsx';
import { AutoBuildNote } from './auto-build-note.tsx';
import { Figures, ROW_ACTION, ROW_RULE, RowSecondLine, figuresOf, opensItem } from './columns.tsx';
import { threadAtWork, threadsOf } from './dossier-parts.ts';
import { RowKind, RowSource } from './row-identity.tsx';
import type { StageRow as Row } from './stage-rows.ts';
import { OnYourDesk, YOURS, ROW_OPENS, picked, threadText } from './stage-track.tsx';

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
        ...b.map((s) => ({ s, word: 'blocked', tone: 'text-(--st-review)' })),
        ...a.map((s) => ({ s, word: 'active', tone: 'text-(--st-now)' })),
    ];
};

/** Which concept or parent the row's work belongs to. */
function PartOf({ concept }: { concept: Item }) {
    const text = `${concept.kind === 'concept' ? 'Concept' : 'Part of'}: ${concept.title}`;

    return (
        <span
            data-concept
            title={text}
            className="max-w-44 min-w-16 shrink-[100] truncate rounded bg-(--muted) px-1.5 text-(--muted-foreground)"
        >
            {text}
        </span>
    );
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
    const disconnected = useBoardStore((state) => !!state.clientError);
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
        <li data-item={item.id} className={`@container py-2 ${ROW_RULE} hover:bg-(--accent) ${picked(isPicked)}`}>
            <div className="row-first">
                <button
                    type="button"
                    data-row-open
                    data-meta
                    onClick={() => useItemDialogStore.getState().open(item.id)}
                    className={`row-cols ${ROW_OPENS}`}
                >
                    {n === undefined ? (
                        <span className="grid size-6 place-items-center" data-glyph>
                            <ItemStatusGlyph item={item} />
                        </span>
                    ) : (
                        <span className="queue-n text-center font-medium tabular-nums">{n + 1}</span>
                    )}
                    <RowSource item={item} />
                    <span className="flex min-w-0 items-center" data-kind>
                        <RowKind item={item} />
                    </span>
                    <span className="flex min-w-0 items-center gap-2" data-title-cell>
                        <span
                            className="min-w-0 truncate text-sm leading-7 font-medium text-(--foreground)"
                            title={itemName(item)}
                            data-title
                        >
                            <ItemTitle item={item} />
                        </span>
                        {concept && <PartOf concept={concept} />}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden" data-col="state">
                        {n === undefined ? (
                            <span
                                className="max-w-full shrink-0 truncate"
                                title={threadText(item, shown.working)}
                                data-state
                            >
                                {state}
                            </span>
                        ) : (
                            <span className="queue-age shrink-0 tabular-nums" data-state>
                                <Age at={item.updatedAt} />
                            </span>
                        )}
                        <KindMarker item={item} />
                        <AzureFields azure={item.azure} />
                    </span>
                </button>
                <span data-col="side" className={`row-side ${ROW_ACTION}`}>
                    <Side item={item} data={data} />
                </span>
            </div>
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
                            <button
                                type="button"
                                aria-expanded={slices}
                                aria-label={slices ? 'Hide slices' : 'Show slices'}
                                onClick={() => setSlices(!slices)}
                                data-col="count"
                                className={`flex h-4 items-center gap-1 justify-self-start rounded tabular-nums hover:text-(--foreground) ${ROW_OPENS}`}
                            >
                                {done}/{item.slices.length} slices
                                {slices ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            </button>
                        )
                    }
                >
                    {blocked && (
                        <Badge tone="danger" className="min-w-0" title={blocked} data-blocked>
                            <span className="truncate">{blocked}</span>
                        </Badge>
                    )}
                    {showsActivity ? (
                        <ActivityLine item={item} />
                    ) : (
                        (note[0] || implemented) && (
                            <span
                                data-note
                                className="min-w-0 truncate"
                                title={note.map(({ s, word }) => `${word} ${itemName(s)}`).join('\n') || undefined}
                            >
                                {note[0] && (
                                    <>
                                        <span className={`font-medium ${note[0].tone}`}>{note[0].word}</span>{' '}
                                        <span className="text-(--foreground)">{note[0].s.title}</span>
                                        {note.length > 1 && ` +${note.length - 1} more`}
                                    </>
                                )}
                                {implemented && <span>All slices implemented</span>}
                            </span>
                        )
                    )}
                </RowSecondLine>
            )}
            {['Queued', 'Ready', 'In progress'].includes(item.status) && (
                <div className="pt-1 pr-3 pl-12 empty:hidden">
                    <StartMessage item={item} kind={item.status === 'Queued' ? 'refine' : 'build'} />
                    <StartAfterError item={item} data={data} />
                    <AutoBuildNote item={item} data={data} />
                </div>
            )}
            {slices && (
                <div className="pt-1 pr-3 pl-10" data-slices>
                    <SliceList item={item} still={still} />
                </div>
            )}
        </li>
    );
}
