// The tracker's labels on a Lar Factory project's settings page: the list of them, each row with its chip, detail and
// actions and the editor it opens, and the line that creates one.

import type { FormEvent, ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The tracker's labels, a row each, in a bordered list that never grows past its section. */
export function TrackerLabelList({
    children,
}: {
    /** The labels, one TrackerLabelRow each. */
    children: ReactNode;
}) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border p-0">
            {children}
        </ul>
    );
}

/**
 * A label's row: its `chip`, its `detail` (truncating, its tooltip giving it whole), then its `actions`, with the
 * `editor` it has open under them.
 */
export function TrackerLabelRow({
    chip,
    detail,
    actions,
    editor,
    ...data
}: {
    /** The label's chip. */
    chip: ReactNode;
    /** The label's description, truncating. */
    detail?: string | undefined;
    /** The row's actions, such as Edit. */
    actions?: ReactNode;
    /** The editor it has open, a TrackerLabelEditor. */
    editor?: ReactNode;
} & DataAttributes) {
    return (
        <li {...data} className="border-b last:border-b-0">
            <div className="flex min-w-0 items-center gap-3 px-3 py-1.5">
                <span className="max-w-[45%] min-w-0">{chip}</span>
                <span className="text-fg-muted min-w-0 flex-1 truncate text-xs" title={detail}>
                    {detail}
                </span>
                {actions && <span className="flex shrink-0 gap-1">{actions}</span>}
            </div>
            {editor}
        </li>
    );
}

/** The editor a label's row opens, ruled off under it on a faint tint. */
export function TrackerLabelEditor({
    onSubmit,
    children,
}: {
    /** Called as the reader saves the label. */
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    /** The editor's fields and buttons. */
    children: ReactNode;
}) {
    return (
        <form className="bg-surface-sunken grid gap-3 border-t p-3" onSubmit={onSubmit}>
            {children}
        </form>
    );
}

/** The line that creates a label: its name field and the button that submits it, wrapping when they don't fit. */
export function CreateLabelForm({
    onSubmit,
    children,
}: {
    /** Called as the reader creates the label. */
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    /** The name field and the submit button. */
    children: ReactNode;
}) {
    return (
        <form className="flex max-w-full min-w-0 flex-wrap gap-2" onSubmit={onSubmit}>
            {children}
        </form>
    );
}
