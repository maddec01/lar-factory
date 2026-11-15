// The frame of Lar Factory's item dialog: the summary under its title, the body's column with the main column and the
// sidebar beside it, its notes, and the footer's groups of actions.

import { Alert } from '@lar-works/design-system';
import { linkRecipe } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { ButtonDensityProvider } from './ButtonDensity';
import type { DataAttributes } from './DataAttributes';
import { StateWord } from './StateWord';

/**
 * The item's properties at the top of the dialog's sidebar, a label beside each value: its status, where its ticket
 * lives, its kind and its parent, then its ticket `actions`.
 */
export function ItemSummary({
    status,
    project,
    kind,
    parent,
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
    /** The ticket's actions. */
    actions: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid min-w-0 gap-1">
            <AsideProp label="Status">{status}</AsideProp>
            <AsideProp label="Project">{project}</AsideProp>
            <AsideProp label="Kind">{kind}</AsideProp>
            {parent && <AsideProp label="Part of">{parent}</AsideProp>}
            <div className="flex flex-wrap items-start gap-2 empty:hidden">{actions}</div>
        </div>
    );
}

/** One property in the dialog's sidebar: its muted label in a fixed column, its value beside it. */
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
        <div className="grid min-h-6 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 text-xs">
            <span className="text-fg-muted">{label}</span>
            <span className="text-fg flex min-w-0 flex-wrap items-center gap-1.5 wrap-anywhere">{children}</span>
        </div>
    );
}

/** The summary's status word, in the text colour. */
export function SummaryStatus({
    children,
    title,
}: {
    /** Secondary context, such as a recorded workflow stage. */
    title?: string;
    /** The status word. */
    children: ReactNode;
}) {
    return (
        <span title={title} className="text-fg font-medium">
            {children}
        </span>
    );
}

/** A dependency holding the item, as the board's blocked rows show it: the waiting light and what it waits on. */
export function SummaryBlocked({
    children,
}: {
    /** The dependency holding the item. */
    children: ReactNode;
}) {
    return <StateWord state="waiting">{children}</StateWord>;
}

/** The item's parent: `prefix` ("Part of"), then its `name`, linked when `href` opens it. */
export function SummaryParent({
    prefix,
    name,
    href,
    ...data
}: {
    /** The words before the parent, such as "Part of". */
    prefix: string;
    /** The parent's name. */
    name: string;
    /** The parent's page; the name is plain text without one. */
    href?: string | undefined;
} & DataAttributes) {
    return (
        <p {...data} className="m-0 min-w-0 wrap-anywhere">
            <span className="sr-only">{prefix} </span>
            {href ? (
                <a href={href} target="_blank" rel="noopener" className={linkRecipe.accent}>
                    {name}
                </a>
            ) : (
                name
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
 *  and comments, one under another; filling, its open editor takes the height the rest leave. */
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
            className={`@split:col-start-1 @split:row-start-1 min-w-0 gap-5 ${fill ? 'flex min-h-0 flex-col' : 'grid grid-cols-[minmax(0,1fr)] content-start'}`}
            data-item-main
        >
            {children}
        </div>
    );
}

/** The sidebar beside the main column, once there is room: a softly filled card with a hairline edge, so it reads as its own
 *  panel on any screen, its groups (properties, figures, people and dates, threads) split by full-width dividers. */
export function ItemDialogAside({
    children,
}: {
    /** The sidebar's sections. */
    children: ReactNode;
}) {
    return (
        <aside
            className="@split:col-start-2 @split:row-start-1 bg-fill-muted border-line divide-line grid min-w-0 grid-cols-[minmax(0,1fr)] content-start divide-y self-start rounded-xl border shadow-(--shadow-raised) [&>*]:px-4 [&>*]:py-3"
            data-item-aside
        >
            {children}
        </aside>
    );
}

/** The item's agent figures in the sidebar, time, tokens and cost, under its properties; nothing when there are none. */
export function AsideFigures({
    children,
}: {
    /** The figures and any note on them. */
    children: ReactNode;
}) {
    return <div className="grid min-w-0 gap-1 empty:hidden [&_[data-agent-work]]:leading-5">{children}</div>;
}

/** The item's agent figures as sidebar properties, one labelled row each, with any `note` (such as that they are the last
 *  known) muted under them; `title` gives them in full. */
export function FigureRows({
    rows,
    title,
    note,
}: {
    /** The figures, each its label and value. */
    rows: { label: string; value: string }[];
    /** The figures in full, as their tooltip. */
    title: string;
    /** A word on the figures, such as "Last known". */
    note?: string | undefined;
}) {
    return (
        <div className="grid min-w-0 gap-1 tabular-nums" title={title} data-agent-work>
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
