// A dossier in Lar Factory's board's dock (Concepts and linked work): its one line, on the stage rows' columns, which
// expands in place to its body, and what the line holds: its toggle, title, chips, what's next and the bar of its parts.

import { Button, TickMeter, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

import { buttonKind } from './ButtonKinds';
import { FoldChevron } from './FoldToggle';
import { pickedRow, ROW_BOX, ROW_OPENS } from './RowStyles';

const stop = (event: MouseEvent) => event.stopPropagation();

/** A dossier, a line on its section's card like a stage row, named by `label`; `id` names it as `data-dossier`. */
export function DossierRow({
    id,
    label,
    children,
}: {
    /** The dossier's item, named as `data-dossier`. */
    id: string;
    /** Names the dossier for screen readers. */
    label: string;
    /** The dossier's line and, expanded, its body. */
    children: ReactNode;
}) {
    return (
        <article className="@container" data-dossier={id} aria-label={label}>
            {children}
        </article>
    );
}

/** The dossiers in the dock, rounded rows a hair apart. */
export function DossierList({
    children,
}: {
    /** The dossiers, one DossierRow each. */
    children: ReactNode;
}) {
    return (
        <div className="grid gap-0.5" data-dossiers>
            {children}
        </div>
    );
}

/** The chevron that expands a dossier in place, named by what it does now. */
export function DossierToggle({
    open,
    label,
    onToggle,
}: {
    /** The dossier is expanded. */
    open: boolean;
    /** What the chevron does now, such as "Expand". */
    label: string;
    /** Called as the reader expands or collapses the dossier. */
    onToggle: () => void;
}) {
    return (
        // The 28px App control centred on the rows' 24px glyph column, which keeps a KindBadge's [data-kind] hidden.
        <span className="grid w-6 place-items-center">
            <Button
                {...buttonKind('control')}
                iconOnly
                leftIcon={<FoldChevron open={open} />}
                data-dossier-open
                aria-expanded={open}
                aria-label={label}
                onClick={(event) => {
                    stop(event);
                    onToggle();
                }}
            />
        </span>
    );
}

/** A dossier's line: a click anywhere on it but its controls goes to `onClick`; `title` gives what its chips and threads
 *  say; `attention` marks one with work that waits on you, as a stage row's. */
export function DossierLine({
    item,
    picked,
    attention = false,
    title,
    onClick,
    children,
}: {
    /** The dossier's item, named as `data-item`. */
    item: string;
    /** The item the dialog shows now. */
    picked: boolean;
    /** Some of its work waits on you. */
    attention?: boolean;
    /** What its chips and threads say, as the line's tooltip. */
    title?: string | undefined;
    /** Called with a click anywhere on the line but its controls. */
    onClick?: (event: MouseEvent<HTMLDivElement>) => void;
    /** The line's cells. */
    children: ReactNode;
}) {
    return (
        <div
            onClick={onClick}
            data-item={item}
            data-attention={attention || undefined}
            title={title}
            className={`${ROW_BOX} cursor-pointer py-1.5 ${pickedRow(picked)}`}
        >
            {children}
        </div>
    );
}

/** The dossier line's title cell: its title, tracker fields, note and other repositories, the title keeping its room. */
export function DossierTitleCell({
    children,
}: {
    /** The title, fields, note and other repositories. */
    children: ReactNode;
}) {
    return (
        <span className="flex min-w-0 items-center gap-2" data-line="1" data-title-cell>
            {children}
        </span>
    );
}

/** The dossier's title as the button that opens its item; `name` gives it whole. */
export function DossierTitle({
    name,
    onOpen,
    children,
}: {
    /** The title in full, as its tooltip. */
    name: string;
    /** Called as the reader opens the item. */
    onOpen: () => void;
    /** The title, an ItemTitle. */
    children: ReactNode;
}) {
    // The title keeps the cell's room, but only its words open the item, with the pointer and an underline on hover as
    // a link's; a click on the room after them expands the dossier, as anywhere else on its line.
    return (
        <span className="flex min-w-0 flex-1">
            <button
                type="button"
                onClick={(event) => {
                    stop(event);
                    onOpen();
                }}
                title={name}
                data-title
                data-opens-title
                className={`text-fg max-w-full min-w-0 cursor-pointer truncate rounded-xs text-left text-sm leading-7 underline-offset-2 hover:underline ${ROW_OPENS}`}
            >
                {children}
            </button>
        </span>
    );
}

/** After the fields: a note, such as where its planning is saved; its clicks stay there. */
export function DossierNote({
    children,
}: {
    /** The note, such as a PlanningNote. */
    children: ReactNode;
}) {
    return (
        // The title keeps its room; the note gives way first and ends in an ellipsis.
        <span
            onClick={stop}
            className="flex max-w-[40%] min-w-0 shrink-[100] items-center overflow-hidden pl-1 empty:hidden [&_*]:truncate"
        >
            {children}
        </span>
    );
}

/** A dossier chip's tone. */
export type DossierChipTone = 'warning' | 'danger' | 'neutral' | 'accent' | 'success';

/** The dossier's first chip whole, at its full width, as its icon and words (in the foreground when it asks something
 *  of you), then how many `more` there are, which they name on hover, so the row keeps to one summary. Its clicks
 *  stay there. */
export function DossierChips({
    first,
    more,
}: {
    /** The first chip: its words, tone, icon and whether it is refined. */
    first: { words: string; tone: DossierChipTone; icon?: ReactNode; refined?: boolean | undefined };
    /** The other chips' words. */
    more: string[];
}) {
    return (
        <span onClick={stop} className="flex min-w-0 flex-wrap items-center gap-2" data-chips>
            <span
                className={`flex items-center gap-1.5 whitespace-nowrap tabular-nums [&>svg]:size-3.5 ${first.tone === 'warning' || first.tone === 'danger' ? 'text-fg' : 'text-fg-muted'}`}
                data-chip
                data-tone={first.tone}
                data-refined={first.refined || undefined}
            >
                {first.icon}
                {first.words}
            </span>
            {/* The rest follow in words, so no count goes unexplained. */}
            {more.length > 0 && (
                <span className="text-fg-muted text-xs whitespace-nowrap" data-chips-more>
                    · {more.join(' · ')}
                </span>
            )}
        </span>
    );
}

/** An expanded dossier's view controls, in its action slot. */
export function DossierTools({
    children,
}: {
    /** The view controls. */
    children: ReactNode;
}) {
    return (
        <span className="flex shrink-0 items-center" data-dossier-tools>
            {children}
        </span>
    );
}

/** What's next, as a sentence in the second line's text slot: a `word` naming it, in the warning tone when it waits on
 *  you, screen-reader text alone when `unseen`, then the `text` that names it. */
export function DossierNext({
    word,
    yours = false,
    unseen = false,
    strong = false,
    text,
}: {
    /** What's next is the owner's to start: its text reads at the row's full strength. */
    strong?: boolean;
    /** The word that names what's next, such as "Next". */
    word?: string | undefined;
    /** What's next waits on you: the word takes the warning tone. */
    yours?: boolean;
    /** The word is for screen readers alone. */
    unseen?: boolean;
    /** What's next, as a sentence. */
    text: string;
}) {
    return (
        <span className="min-w-0" data-next>
            <span className="flex min-w-0 items-center gap-2">
                {yours && !unseen && <span aria-hidden="true" className="bg-warning size-2 shrink-0 rounded-full" />}
                {word && (
                    <span
                        className={`shrink-0 font-medium ${yours ? 'text-warning-fg' : 'text-fg-muted'} ${unseen ? 'sr-only' : ''}`}
                    >
                        {word}
                    </span>
                )}
                <span className={`min-w-0 truncate ${strong ? 'text-fg' : ''}`} title={text}>
                    {text}
                </span>
            </span>
        </span>
    );
}

/** One part in PartsBar: its name and state, its colour, and whether it pulses while at work. */
export interface PartSegment {
    key: string;
    title: string;
    color: string;
    pulse?: boolean;
}

/** Every part as a segment in its colour (the design system's segmented track), so the bar fills left to right, then an
 *  outlined one per part the board doesn't read. */
export function PartsBar({
    title,
    parts,
    done,
    total,
}: {
    /** What the bar shows, as its tooltip and its name for screen readers. */
    title: string;
    /** The parts the board reads, each a segment in its colour; done ones are counted by `done`. */
    parts: PartSegment[];
    /** How many parts are done, those off the board included. */
    done: number;
    /** How many parts there are, those off the board included. */
    total: number;
}) {
    // Done parts lead in the done colour, then the open parts the board reads in theirs, then what's left on the track.
    // Past eight parts the bar is one fill of the done share, as segments that small read as dots.
    const open = parts.filter((p) => p.color !== 'var(--color-board-done)');
    const segments =
        total > 8
            ? [{ label: title, color: 'var(--color-board-done)', value: total ? done / total : 0 }]
            : [
                  ...Array.from({ length: done }, () => ({ label: 'Done', color: 'var(--color-board-done)' })),
                  ...open
                      .slice(0, Math.max(0, total - done))
                      .map((p) => ({ label: p.title, color: p.color, pulse: p.pulse })),
                  ...Array.from({ length: Math.max(0, total - done - open.length) }, () => ({ label: 'To do' })),
              ];

    return (
        <div className="min-w-0" title={title} data-part-bar>
            <TickMeter label={title} size="sm" segments={segments} />
        </div>
    );
}

/** What an expanded dossier holds, indented under its line as a row's slices are; its parts are rows, as a lane's. */
export function DossierBody({
    tools,
    children,
}: {
    /** The parts' view controls, at the body's top right under a quiet "Parts" label, so the row above keeps its edge. */
    tools?: ReactNode;
    /** What the expanded dossier holds. */
    children: ReactNode;
}) {
    return (
        <div
            className="ml-9 grid gap-2 pt-1 pb-2 [&>*]:pr-3 [&>*]:pl-9 [&>:has(>ol,>ul)]:pr-0 [&>:has(>ol,>ul)]:pl-6"
            data-dossier-body
        >
            {tools && (
                <div className="flex min-h-7 items-center justify-between gap-3" data-dossier-view>
                    <span className="text-fg-muted text-xs">Parts</span>
                    {tools}
                </div>
            )}
            {children}
        </div>
    );
}

/** Where a dossier's planning is saved, as a quiet label; hovering or focusing it reads the whole `note`. */
export function PlanningNote({
    note,
    role,
    children,
}: {
    /** Where the planning is saved, in full. */
    note: string;
    /** `status` while the note changes as the planning saves; `note` once it stands. */
    role: 'status' | 'note';
    /** The note's short label. */
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    role={role}
                    aria-label={note}
                    data-structure-sync
                    className="text-fg-muted focus-ring rounded-xs whitespace-nowrap"
                >
                    {children}
                </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{note}</TooltipPopup>
        </Tooltip>
    );
}

/** The slot a dossier's most important chip takes on its title's line: the title keeps its room, the chip gives way
 *  first and ends in an ellipsis. */
export function DossierChip({ children }: { children: ReactNode }) {
    return (
        <span className="flex max-w-[40%] min-w-0 shrink-[100] items-center overflow-hidden [&_*]:truncate">
            {children}
        </span>
    );
}
