// The frame of Lar Factory's item dialog: the summary under its title, the body's column with the main column and the
// sidebar beside it, its notes, and the footer's groups of actions.

import { Alert } from '@lar-works/design-system';
import { linkRecipe } from '@lar-works/design-system/primitives';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ButtonDensityProvider } from './ButtonDensity';
import type { DataAttributes } from './DataAttributes';
import { StateWord } from './StateWord';

/**
 * The item's properties at the top of the dialog's sidebar, a label beside each value, each on one line: its status,
 * where its ticket lives, its kind and its parent, then a quiet `note` and its ticket `actions` on a Ticket row.
 */
export function ItemSummary({
    status,
    project,
    kind,
    parent,
    note,
    actions,
    ...data
}: {
    /** The item's status glyph and word, and what blocks it. */
    status: ReactNode;
    /** Where its ticket is saved and its repository. */
    project: ReactNode;
    /** The item's kind, or the control that changes it. */
    kind: ReactNode;
    /** The item's parent, a SummaryParent. */
    parent?: ReactNode;
    /** A quiet line under the properties, such as why its plan isn't on its tracker yet. */
    note?: ReactNode;
    /** The ticket's actions, short buttons such as Attach and Create, or the panel one of them opened. */
    actions: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid min-w-0 gap-1">
            <AsideProp label="Status">{status}</AsideProp>
            <AsideProp label="Project">{project}</AsideProp>
            <AsideProp label="Kind">{kind}</AsideProp>
            {parent && <AsideProp label="Part of">{parent}</AsideProp>}
            {note && <span className="text-fg-muted min-w-0 truncate text-xs leading-5 empty:hidden">{note}</span>}
            {/* A property row of its own, label and buttons on the columns above; an opened panel takes the full width.
                It shows only while it holds a button or a panel. */}
            <div
                className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 pt-1 text-xs has-[section]:grid-cols-[minmax(0,1fr)] [&:has(section)>[data-label]]:hidden [&:not(:has(button,section))]:hidden"
                data-ticket-actions
            >
                <span className="text-fg-muted leading-7" data-label>
                    Ticket
                </span>
                {/* Quiet buttons, the first one's word on the values' column, as the properties above read. */}
                <span className="flex min-w-0 flex-wrap items-center gap-1 [&>[data-slot=button]:first-child]:-ml-2.75 [&>section]:basis-full">
                    {actions}
                </span>
            </div>
        </div>
    );
}

/** One property in the dialog's sidebar: its muted label in a fixed column, its value beside it, the label on the value's
 *  first line when the value runs longer. */
function AsideProp({
    label,
    children,
}: {
    /** What the property is, such as "Status". */
    label: string;
    /** Its value. */
    children: ReactNode;
}) {
    return (
        <div className="grid min-h-6 grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 text-xs">
            <span className="text-fg-muted leading-6">{label}</span>
            <span className="text-fg flex min-h-6 min-w-0 flex-wrap items-center gap-1.5 wrap-anywhere">
                {children}
            </span>
        </div>
    );
}

/** The summary's status word, in the text colour, on one line. */
export function SummaryStatus({
    children,
    title,
}: {
    /** Secondary context, such as a recorded workflow stage. */
    title?: string | undefined;
    /** The status word. */
    children: ReactNode;
}) {
    return (
        <span title={title} className="text-fg min-w-0 truncate font-medium">
            {children}
        </span>
    );
}

/** What holds the item, as the board's blocked rows show it: the waiting light and a short word, `title` in full. */
export function SummaryBlocked({
    title,
    children,
}: {
    /** What holds it in full. */
    title?: string | undefined;
    /** The short word, such as "Blocked". */
    children: ReactNode;
}) {
    return (
        <StateWord state="waiting" title={title}>
            {children}
        </StateWord>
    );
}

/** The item's parent: `prefix` ("Part of"), then its whole `name`, wrapping over as many lines as it takes, a link that
 *  opens it in the dialog (`onOpen`), else its page (`href`); plain text with neither. */
export function SummaryParent({
    prefix,
    name,
    onOpen,
    href,
    ...data
}: {
    /** The words before the parent, such as "Part of". */
    prefix: string;
    /** The parent's name. */
    name: string;
    /** Opens the parent in the dialog, when it is on the board. */
    onOpen?: (() => void) | undefined;
    /** The parent's page, when it isn't on the board; the name is plain text without either. */
    href?: string | undefined;
} & DataAttributes) {
    return (
        <p {...data} className="m-0 min-w-0 py-1 leading-4 wrap-break-word">
            <span className="sr-only">{prefix} </span>
            {onOpen ? (
                <button
                    type="button"
                    onClick={onOpen}
                    className={`focus-ring text-left ${linkRecipe.accent}`}
                    data-parent-open
                >
                    {name}
                </button>
            ) : href ? (
                <a href={href} target="_blank" rel="noopener" className={linkRecipe.accent}>
                    {name}
                </a>
            ) : (
                <span>{name}</span>
            )}
        </p>
    );
}

/** A labelled control the summary opens in place, such as Attach a ticket's picker: `label` over it. */
export function SummaryPanel({
    label,
    children,
}: {
    /** The control's label, over it. */
    label: string;
    /** The control, such as Attach a ticket's picker. */
    children: ReactNode;
}) {
    return (
        <section aria-label={label} className="grid gap-1.5 pt-1">
            <span className="text-fg text-xs font-medium">{label}</span>
            {children}
        </section>
    );
}

/**
 * The dialog body's column: the progress, notes, meta area, record, description, comments and sidebar, one under the
 * other; when it `fill`s, a column whose description and comments take what the rest leave.
 */
export function ItemDialogBody({
    fill,
    children,
    ...data
}: {
    /** Its column takes the dialog's height, for an open editor. */
    fill: boolean;
    /** The progress, notes, meta area, record, description, comments and sidebar. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div
            {...data}
            className={`@container gap-4 pt-2 ${fill ? 'flex min-h-0 flex-1 flex-col' : 'grid grid-cols-[minmax(0,1fr)] content-start'}`}
        >
            {children}
        </div>
    );
}

/**
 * The main column with the sidebar beside it once the dialog is 45rem wide, when there is an `aside`. Filling, the
 * main column's open editor takes the height the rest leaves.
 */
export function ItemDialogColumns({
    aside,
    fill,
    children,
}: {
    /** There is a sidebar to set beside the main column. */
    aside: boolean;
    /** The main column's open editor takes the height left. */
    fill: boolean;
    /** The main column and the ItemDialogAside. */
    children: ReactNode;
}) {
    const rows = fill ? 'min-h-0 flex-1' : '';

    return (
        <div
            className={`grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 ${aside ? '@split:grid-cols-[minmax(0,1fr)_18rem]' : ''} ${rows}`}
        >
            {children}
        </div>
    );
}

/** The dialog's main column: what waits on you, where the work stands, what its agents do, then the record, description
 *  and comments, one under another; filling, its open editor takes the height the rest leave. Every section shares one
 *  content width: its prose fills the column, as its lists and headers do, so a description ends where the parts list
 *  above it does; the column stops at a reading width of its own, so a wide dialog never runs a line too long. */
export function ItemMainColumn({
    fill,
    children,
}: {
    /** Its open editor takes the height the rest leave. */
    fill: boolean;
    /** The main column's sections. */
    children: ReactNode;
}) {
    return (
        <div
            className={`@split:col-start-1 @split:row-start-1 max-w-[52rem] min-w-0 gap-5 [--container-reading:100%] ${fill ? 'flex min-h-0 flex-col' : 'grid grid-cols-[minmax(0,1fr)] content-start'}`}
            data-item-main
        >
            {children}
        </div>
    );
}

/** The sidebar beside the main column, once there is room: a softly filled card with a hairline edge, so it reads as its own
 *  panel on any screen, its groups (properties, figures, people and dates, threads) split by full-width dividers. While
 *  it fits the dialog's scroll area it stays in view as a long record scrolls beside it. */
export function ItemDialogAside({
    children,
}: {
    /** The sidebar's sections. */
    children: ReactNode;
}) {
    const [ref, fits] = useFitsScrollArea();

    return (
        <aside
            ref={ref}
            className="@split:col-start-2 @split:row-start-1 @split:data-fits:sticky @split:data-fits:top-0 bg-fill-muted border-line divide-line grid min-w-0 grid-cols-[minmax(0,1fr)] content-start divide-y self-start rounded-xl border shadow-(--shadow-raised) [&>*]:px-4 [&>*]:py-3"
            data-item-aside
            data-fits={fits || undefined}
        >
            {children}
        </aside>
    );
}

/** Whether the element fits the height of the dialog body it scrolls in, inside its padding, kept up as either resizes:
 *  a sidebar taller than that scrolls with the rest, so none of it is ever out of reach. */
function useFitsScrollArea() {
    const ref = useRef<HTMLElement>(null);
    const [fits, setFits] = useState(false);

    useEffect(() => {
        const element = ref.current;
        const area = element?.closest<HTMLElement>('[data-slot="modal-body"]');

        if (!element || !area || typeof ResizeObserver === 'undefined') return;

        const measure = () => {
            const style = getComputedStyle(area);
            const room = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

            setFits(element.offsetHeight <= room);
        };
        const observer = new ResizeObserver(measure);

        observer.observe(element);
        observer.observe(area);

        return () => observer.disconnect();
    }, []);

    return [ref, fits] as const;
}

/** The item's agent figures in the sidebar, time, tokens and cost, under its properties; nothing when there are none. */
export function AsideFigures({
    children,
}: {
    /** The figures and any note on them. */
    children: ReactNode;
}) {
    return <div className="grid min-w-0 gap-3 empty:hidden [&_[data-agent-work]]:leading-5">{children}</div>;
}

/** The item's agent figures as sidebar properties, one labelled row each in the same grid as Status and Project, under
 *  any `heading` that says whose they are ("This concept", "Including parts"), with any `note` (such as that they are
 *  the last known) muted under them; `title` gives them in full. */
export function FigureRows({
    rows,
    title,
    heading,
    note,
    ...data
}: {
    /** The figures, each its label and value, such as "Agent time" and "2h 29m". */
    rows: { label: string; value: string }[];
    /** The figures in full, as their tooltip. */
    title?: string | undefined;
    /** Whose figures they are, over them, such as "This concept". */
    heading?: string | undefined;
    /** A word on the figures, such as "Last known". */
    note?: string | undefined;
} & DataAttributes) {
    return (
        <div className="grid min-w-0 gap-1 tabular-nums" title={title || undefined} data-agent-work {...data}>
            {heading && (
                <span className="text-fg-muted text-xs leading-6 font-medium" data-figures-heading>
                    {heading}
                </span>
            )}
            {rows.map((row) => (
                <AsideProp key={row.label} label={row.label}>
                    {row.value}
                </AsideProp>
            ))}
            {note && <span className="text-fg-muted text-xs">{note}</span>}
        </div>
    );
}

/** A warning about the item, such as why it is paused, in the warning panel: `icon` (a status glyph) before it when
 *  given. */
export function WarningNote({
    icon,
    children,
    ...data
}: {
    /** A status glyph before the warning. */
    icon?: ReactNode;
    /** The warning, such as why the item is paused. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data}>
            <Alert size="sm" tone="warning" icon={icon} message={children} />
        </div>
    );
}

/** Why the factory can't write to the item's tracker, announced, and the `action` that checks again. */
export function AccessNotice({
    message,
    action,
}: {
    /** Why the factory can't write to the tracker, announced. */
    message: string;
    /** The button that checks again. */
    action: ReactNode;
}) {
    return (
        <Alert
            tone="warning"
            size="sm"
            role="status"
            aria-live="polite"
            description={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="min-w-48 flex-1">{message}</span>
                    <span className="shrink-0">{action}</span>
                </span>
            }
        />
    );
}

/** A group of the footer's actions: the `leading` ones that move the item, in small text, or the rest at its end. Its
 *  buttons are the dialog footer's `md` 32px, as in every dialog. */
export function DialogActions({
    presentation = 'trailing',
    children,
}: {
    /** `leading` for the actions that move the item, in small text; `trailing` for the rest, at the end. */
    presentation?: 'leading' | 'trailing';
    /** The actions. */
    children: ReactNode;
}) {
    return (
        <span
            className={
                presentation === 'leading'
                    ? 'inline-flex max-w-full min-w-0 flex-wrap items-center gap-3 text-xs'
                    : 'inline-flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1.5'
            }
        >
            <ButtonDensityProvider density="md">{children}</ButtonDensityProvider>
        </span>
    );
}
