// A dossier's one line in the dock: its identity, first chip and Start, then its parts bar, what's next and figures.

import { itemActivityStill, itemName } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { ambientMotion, Badge } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

import { Figures, ROW_ACTION, RowSecondLine, figuresOf } from './Columns';
import { open, stop, usePicked } from './DossierHelpers';
import { isDone, threadsOf } from './DossierParts';
import type { Part } from './DossierParts';
import { moving, otherRepos, nextOf, chipsOf, rowTooltip } from './DossierSummary';
import type { Moving, Chip } from './DossierSummary';
import { PartStart } from './PartStart';
import { RowKind, RowSource } from './RowIdentity';
import { ROW_OPENS, stageOf, picked } from './StageTrack';
import {
    AzureFields,
    ItemTitle,
    shownStatus,
    useActivityUnavailable,
    KeepClicks,
    STATUS_COLOR,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';

/** Every part as a segment in its status colour, done first, so the bar fills left to right; a dashed one per part the board doesn't read. */
function PartsBar({ m }: { m: Moving }) {
    const order = [...m.parts].sort(
        (a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status),
    );
    const unread = m.count - m.parts.length;
    const unavailable = useActivityUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);

    return (
        <ol
            className="m-0 flex min-w-0 list-none gap-[2px] overflow-hidden p-0"
            title={`${m.done}/${m.count} parts done`}
            data-part-bar
        >
            {order.map((p) => {
                const { word, glyph } = shownStatus(p.item, unavailable);
                // oxlint-disable-next-line react/purity -- the pulse reads the time as of this render; board updates render the bar again
                const pulse = glyph === 'In progress' && !itemActivityStill(p.item, Date.now(), disconnected);

                return (
                    <li
                        key={p.item.id}
                        ref={pulse ? ambientMotion : undefined}
                        title={`${itemName(p.item)}: ${isDone(p.item) ? 'Complete' : word}`}
                        className={`h-1.5 min-w-[3px] flex-1 rounded-full ${pulse ? 'status-pulse' : ''}`}
                        style={{
                            background: isDone(p.item)
                                ? 'var(--st-done)'
                                : glyph === 'Queued' || glyph === 'List'
                                  ? 'var(--soft)'
                                  : STATUS_COLOR[glyph],
                        }}
                    />
                );
            })}
            {Array.from({ length: Math.max(0, unread) }, (_, n) => (
                <li
                    key={`u${n}`}
                    className="h-1.5 min-w-[3px] flex-1 rounded-full border border-dashed border-(--input)"
                />
            ))}
        </ol>
    );
}

/** Line 1's Azure fields: they give up their room before the title does, ending in an ellipsis.
 *  Below `lg` they may shrink to nothing, so a narrow line's title keeps its room; their tooltips keep the text. */
const META = 'min-w-0 lg:min-w-10 shrink-[1000] truncate';

/** The first chip whole, at its full width, and how many more the row's tooltip names. An empty dossier takes no room. */
function Chips({ chips }: { chips: Chip[] }) {
    const [first, ...rest] = chips;

    if (!first) return null;

    return (
        <span onClick={stop} className="flex shrink-0 items-center gap-1" data-chips>
            <Badge
                tone={first.tone}
                className="whitespace-nowrap tabular-nums"
                data-chip
                data-refined={first.refined || undefined}
            >
                {first.icon}
                {first.words}
            </Badge>
            {rest.length > 0 && (
                <span className="text-(--muted-foreground) tabular-nums" data-chips-more>
                    <span aria-hidden="true">+{rest.length}</span>
                    <span className="sr-only">{rest.map((c) => c.words).join(', ')}</span>
                </span>
            )}
        </span>
    );
}

/** Next, as a sentence. */
function Next({ n, badged }: { n: ReturnType<typeof nextOf>; badged: boolean }) {
    // A part on your desk is named as its attention row names it: Needs you, or to verify or merge.
    const yours =
        n.part?.item.status === 'Verify'
            ? 'To verify'
            : n.part?.item.status === 'Ready to merge'
              ? 'To merge'
              : 'Needs you';
    const word = { you: yours, start: 'Next', moving: 'Moving', none: '' }[n.tone];
    const unseen = n.tone === 'start' || (badged && word === 'Needs you');

    return (
        <span className="flex min-w-0 items-center gap-2">
            {/* Start sits in the action slot labelled "Start", and a "need you" badge says Needs you, so those words are screen-reader text and leave their room to the title. */}
            {word && (
                <span
                    className={`shrink-0 font-medium ${n.tone === 'you' ? 'text-(--warning-foreground)' : 'text-(--muted-foreground)'} ${unseen ? 'sr-only' : ''}`}
                >
                    {word}
                </span>
            )}
            <span className="min-w-0 truncate" title={n.text}>
                {n.text}
            </span>
        </span>
    );
}

/** A dossier's one line in the dock; `lead` takes the glyph's column of a stage row, `note` follows its title, and `tools`, an expanded dossier's view controls, sit in the action slot beside any Start. */
export function DossierLine({
    parent,
    parts,
    data,
    lead,
    note,
    tools,
    onClick,
    className = '',
}: {
    parent: Item;
    parts: Part[];
    data: BoardData;
    lead: ReactNode;
    note?: ReactNode;
    tools?: ReactNode;
    onClick?: (e: MouseEvent<HTMLDivElement>) => void;
    className?: string;
}) {
    const isPicked = usePicked(parent);
    const m = moving(parent, parts, useActivityUnavailable());
    const threads = [parent, ...parts.map((p) => p.item)].flatMap(threadsOf);
    const chips = chipsOf(parent, m);
    const n = nextOf(m, parent);
    const repos = otherRepos(parent, m, data);

    return (
        <div
            onClick={onClick}
            data-item={parent.id}
            title={rowTooltip(chips, threads)}
            className={`py-2 ${className} ${picked(isPicked)}`}
        >
            <div className="row-first">
                <div className="row-cols">
                    {lead}
                    <RowSource item={parent} />
                    <span className="flex min-w-0 items-center" data-kind>
                        {parent.kind === 'concept' ? (
                            <RowKind item={parent} />
                        ) : (
                            <Badge tone="neutral">Coupled work</Badge>
                        )}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5" data-line="1" data-title-cell>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                open(parent);
                            }}
                            title={parent.title}
                            data-title
                            className={`min-w-0 truncate rounded text-left text-sm leading-7 font-medium text-(--foreground) hover:underline ${ROW_OPENS}`}
                        >
                            <ItemTitle item={parent} />
                        </button>
                        <span className={`${META} empty:hidden`}>
                            <AzureFields azure={parent.azure} />
                        </span>
                        <span onClick={stop} className="flex shrink-0 items-center pl-1 empty:hidden">
                            {note}
                        </span>
                        <span
                            data-col="repos"
                            className="min-w-16 shrink-[100] truncate text-(--muted-foreground) empty:hidden"
                            title={repos || undefined}
                        >
                            {repos}
                        </span>
                    </span>
                    {/* The first chip keeps its full width; the rest of the chips wait in the tooltip. */}
                    <span className="flex min-w-0 items-center gap-1.5" data-col="state">
                        <Chips chips={chips} />
                    </span>
                </div>
                <span data-col="side" className="row-side">
                    {/* A click beside the controls toggles the row, as anywhere else on it. */}
                    <KeepClicks as="span" passEmpty className={ROW_ACTION}>
                        {tools && (
                            <span className="flex shrink-0 items-center" data-dossier-tools>
                                {tools}
                            </span>
                        )}
                        {n.part && n.tone === 'start' && <PartStart part={n.part} data={data} label="Start" />}
                    </KeepClicks>
                </span>
            </div>
            <RowSecondLine
                bar={<PartsBar m={m} />}
                figures={<Figures s={figuresOf(parent, data, true)} item={parent} total />}
                count={
                    <span data-col="count" className="tabular-nums" title={`${m.done}/${m.count} parts done`}>
                        {m.done}/{m.count} parts
                    </span>
                }
            >
                <span className="min-w-0" data-next>
                    <Next n={n} badged={m.needsYou.length > 0} />
                </span>
            </RowSecondLine>
        </div>
    );
}
