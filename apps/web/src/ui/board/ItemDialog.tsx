// The frame of Lar Factory's item dialog: the summary under its title, the body's column with the main column and the
// sidebar beside it, its notes, and the footer's groups of actions.

import { Alert } from '@lar-works/design-system';
import { linkRecipe } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { ButtonDensityProvider } from './ButtonDensity';
import type { DataAttributes } from './DataAttributes';
import { StateWord } from './StateWord';

/**
 * The summary under the dialog's header, a row each: `line` (the item's source, repository, status and age), its
 * `parent`, its `kind` and its ticket `actions`.
 */
export function ItemSummary({
    line,
    parent,
    kind,
    actions,
    ...data
}: {
    /** The item's source, repository, status and age. */
    line: ReactNode;
    /** The item's parent, a SummaryParent. */
    parent?: ReactNode;
    /** The item's kind, a badge. */
    kind: ReactNode;
    /** The ticket's actions. */
    actions: ReactNode;
} & DataAttributes) {
    return (
        // Under the dialog's 52px header and its hairline, 16px in, as the body's own top inset.
        <div {...data} className="text-fg-muted @container grid shrink-0 gap-1 px-5 pt-4 text-xs sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                {line}
                {kind}
            </div>
            {parent}
            <div className="flex flex-wrap items-start gap-2">{actions}</div>
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
            {prefix}{' '}
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
    const rows = fill ? 'min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]' : aside ? '@split:grid-rows-[auto_1fr]' : '';

    return (
        <div
            className={`grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 ${aside ? '@split:grid-cols-[minmax(0,1fr)_20rem]' : ''} ${rows}`}
        >
            {children}
        </div>
    );
}

/** The sidebar beside the main column, ruled off from it once there is room. */
export function ItemDialogAside({
    children,
}: {
    /** The sidebar's sections. */
    children: ReactNode;
}) {
    return (
        <aside
            className="@split:border-line @split:col-start-2 @split:row-span-2 @split:row-start-1 @split:border-l @split:pl-6 grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4"
            data-item-aside
        >
            {children}
        </aside>
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
