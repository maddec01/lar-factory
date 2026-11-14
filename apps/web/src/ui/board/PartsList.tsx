// An expanded dossier's parts list: each part with what it asks next, its stage track, figures, thread and slices, the
// done parts folded away; and a part's kind as every surface of the dossier names it.

import {
    BookOpenIcon,
    HammerIcon,
    ListChecksIcon,
    MessagesSquareIcon,
    ShapesIcon,
} from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { pickedRow, ROW_OPENS } from './RowStyles';

const KIND_ICON = {
    grill: MessagesSquareIcon,
    prototype: ShapesIcon,
    research: BookOpenIcon,
    task: ListChecksIcon,
    decision: MessagesSquareIcon,
    build: HammerIcon,
} as const;

/** What a dossier's part is: a decision's method, or a build. */
export type PartKind = keyof typeof KIND_ICON;

/** A part's method or kind as its icon alone, such as a row's kind mark draws. */
export function PartKindIcon({ kind }: { kind: PartKind }) {
    const Icon = KIND_ICON[kind];

    return <Icon aria-hidden="true" />;
}

/** A part's method or kind with its icon, in the one place and style every dossier surface shows it. */
export function PartKindLabel({
    kind,
    children,
}: {
    /** The part's method or kind, which picks its icon. */
    kind: PartKind;
    /** The method or kind in words. */
    children: ReactNode;
}) {
    const Icon = KIND_ICON[kind];

    return (
        <span className="text-fg-muted inline-flex shrink-0 items-center gap-1.5 text-xs" data-part-kind>
            <Icon className="size-3.5 shrink-0" />
            {children}
        </span>
    );
}

/** The parts, in as many columns as give each part at least 32rem, then `showDone`, the button that unfolds the done
 *  ones. Columns follow each part's own usable width, not the window's, so a part never squeezes its title and status. */
export function PartsList({
    showDone,
    children,
}: {
    /** The button that unfolds the done parts, a ShowDoneToggle. */
    showDone?: ReactNode;
    /** The parts, one PartRow each. */
    children: ReactNode;
}) {
    return (
        <div className="grid gap-1">
            {/* One column of rounded rows, as a lane's, so a part reads as a row of work, not a card. */}
            <ol className="m-0 grid list-none gap-0.5 p-0" data-parts-list>
                {children}
            </ol>
            {showDone}
        </div>
    );
}

/** The button under the parts that shows or hides the done ones. */
export function ShowDoneToggle({
    open,
    onToggle,
    children,
}: {
    /** The done parts are shown. */
    open: boolean;
    /** Called as the reader shows or hides the done parts. */
    onToggle: () => void;
    /** The button's text, such as "Show 3 done". */
    children: string;
}) {
    return (
        <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="text-fg-muted hover:bg-fill-hover justify-self-start rounded-xs px-2 py-1 text-xs"
        >
            {children}
        </button>
    );
}

/**
 * A part: one button opens its item from its `name`, `meta` (kind, repository, track, status) and `usage` under them,
 * what it asks next (`action`) sits beside that button, then its `second` line (a RowSecondLine) and any `foot`, its
 * start's message or error, under that. The name and status keep at least 12rem, so they never break a word a line; when
 * the part is narrower than that and its action, the action moves under them.
 */
export function PartRow({
    id,
    picked,
    title,
    onOpen,
    name,
    meta,
    usage,
    action,
    second,
    foot,
}: {
    /** The part's item, named as `data-item`. */
    id: string;
    /** The item the dialog shows now. */
    picked: boolean;
    /** The part in full, as the button's tooltip. */
    title: string;
    /** Called as the reader opens the part's item. */
    onOpen: () => void;
    /** The part's name, a PartName. */
    name: ReactNode;
    /** Its kind, repository, track and status. */
    meta: ReactNode;
    /** Its figures, such as cost, agent time and tokens, on their own line under its status. */
    usage?: ReactNode;
    /** What it asks next, beside the button. */
    action: ReactNode;
    /** Its second line, such as its thread. */
    second?: ReactNode;
    /** What sits under the row, such as Start's message. */
    foot?: ReactNode;
}) {
    return (
        <li data-part={id} className={`hover:bg-fill-hover @container rounded-lg px-3 py-2 ${pickedRow(picked)}`}>
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <button
                    type="button"
                    data-row-open
                    onClick={onOpen}
                    title={title}
                    className={`grid min-w-48 flex-1 basis-48 gap-y-1 rounded-xs text-left ${ROW_OPENS}`}
                >
                    {name}
                    <span
                        className="text-fg-muted flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs"
                        data-part-meta
                    >
                        {meta}
                    </span>
                    {usage && (
                        <span className="text-fg-muted min-w-0 pl-5 text-xs tabular-nums" data-part-usage>
                            {usage}
                        </span>
                    )}
                </button>
                <span
                    data-part-action
                    className="text-fg-muted ml-auto flex min-h-7 max-w-full min-w-0 flex-wrap items-center justify-end gap-2 text-xs"
                >
                    {action}
                </span>
            </div>
            {second}
            {foot && <span className="block pt-1 pl-5 empty:hidden">{foot}</span>}
        </li>
    );
}

/** What a part waits on, beside its action, truncating. */
export function PartWaits({
    children,
}: {
    /** What the part waits on, in words. */
    children: string;
}) {
    return (
        <span className="max-w-48 truncate" title={children}>
            {children}
        </span>
    );
}

/** A part's thread in its second line: its glyph, `name` and `state`; `title` names it in full. */
export function ThreadLine({
    glyph,
    name,
    state,
    title,
}: {
    /** The thread's status glyph. */
    glyph: ReactNode;
    /** The thread's name. */
    name: string;
    /** The thread's state in words. */
    state: string;
    /** The thread in full, as its tooltip. */
    title?: string | undefined;
}) {
    return (
        <span className="flex min-w-0 items-center gap-1.5" title={title}>
            {glyph}
            <span className="truncate">{name}</span>
            <span className="shrink-0">· {state}</span>
        </span>
    );
}
