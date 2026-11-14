// A dossier in Lar Factory's board's dock (Concepts and linked work): its one line, on the stage rows' columns, which
// expands in place to its body, and what the line holds: its toggle, title, chips, what's next and the bar of its parts.

import { SegmentedProgress, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { ChevronRightIcon } from '@lar-works/design-system/icons';
import type { MouseEvent, ReactNode } from 'react';

import { pickedRow, ROW_OPENS } from './RowStyles';

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
        <button
            type="button"
            data-dossier-open
            aria-expanded={open}
            aria-label={label}
            onClick={(event) => {
                stop(event);
                onToggle();
            }}
            className={`text-fg-muted hover:bg-fill-hover hover:text-fg grid size-6 shrink-0 place-items-center rounded-md ${ROW_OPENS}`}
        >
            <ChevronRightIcon className={`size-4 ${open ? 'rotate-90' : ''}`} />
        </button>
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
            className={`hover:bg-fill-hover cursor-pointer rounded-lg py-2 ${pickedRow(picked)}`}
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
        <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-line="1" data-title-cell>
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
    return (
        <button
            type="button"
            onClick={(event) => {
                stop(event);
                onOpen();
            }}
            title={name}
            data-title
            className={`text-fg min-w-0 flex-1 rounded-xs text-left text-sm leading-5 wrap-anywhere hover:underline ${ROW_OPENS}`}
        >
            {children}
        </button>
    );
}

/** After the title: the tracker's fields, which give up their room before the title does, ending in an ellipsis. Below
 *  `lg` they may shrink to nothing, so a narrow line's title keeps its room. */
export function DossierFields({
    children,
}: {
    /** The tracker's fields, an ItemFields. */
    children: ReactNode;
}) {
    return <span className="min-w-0 shrink-[1000] truncate empty:hidden lg:min-w-10">{children}</span>;
}

/** After the fields: a note, such as where its planning is saved; its clicks stay there. */
export function DossierNote({
    children,
}: {
    /** The note, such as a PlanningNote. */
    children: ReactNode;
}) {
    return (
        <span onClick={stop} className="flex shrink-0 items-center pl-1 empty:hidden">
            {children}
        </span>
    );
}

/** The repositories its parts work in beyond its own. */
export function DossierRepos({
    children,
}: {
    /** The other repositories, in words. */
    children: string;
}) {
    return (
        <span
            data-col="repos"
            className="text-fg-muted min-w-16 shrink-[100] truncate empty:hidden"
            title={children || undefined}
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
            {/* The rest are in the line's tooltip, so the row keeps to one summary. */}
            {more.length > 0 && (
                <span className="text-fg-muted text-xs whitespace-nowrap" title={more.join(' · ')} data-chips-more>
                    +{more.length} more
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
    text,
}: {
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
                {word && (
                    <span
                        className={`shrink-0 font-medium ${yours ? 'text-warning-fg' : 'text-fg-muted'} ${unseen ? 'sr-only' : ''}`}
                    >
                        {word}
                    </span>
                )}
                <span className="min-w-0 truncate" title={text}>
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
    unread,
}: {
    /** What the bar shows, as its tooltip and its name for screen readers. */
    title: string;
    /** Every part, each a segment in its colour. */
    parts: PartSegment[];
    /** How many parts the board doesn't read, each an outlined segment. */
    unread: number;
}) {
    return (
        <div className="min-w-0" title={title} data-part-bar>
            <SegmentedProgress
                label={title}
                size="sm"
                segments={[
                    ...parts.map((p) => ({ label: p.title, color: p.color, pulse: p.pulse })),
                    ...Array.from({ length: Math.max(0, unread) }, () => ({
                        label: 'Not read by the board',
                        color: 'var(--color-line-strong)',
                        waiting: true,
                    })),
                ]}
            />
        </div>
    );
}

/** What an expanded dossier holds, in a rounded panel under its line; its parts are rows, as a lane's. */
export function DossierBody({
    children,
}: {
    /** What the expanded dossier holds. */
    children: ReactNode;
}) {
    return (
        <div className="grid gap-3 rounded-xl border p-3" data-dossier-body>
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
