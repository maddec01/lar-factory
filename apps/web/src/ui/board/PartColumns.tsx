// A concept dialog's part as one line of aligned columns: its title, then its project, agent figures and state, each track only as
// wide as its widest cell (the list's subgrid, rows.css), so the title takes the room the rest leave.

import type { ReactNode } from 'react';

import { ROW_OPENS } from './RowStyles';

/**
 * A part in a concept dialog's PartsList: one button opens its item from its `name`, `project`, `cost` and `state`, which
 * line up down the list; what it asks next (`action`) takes only the state cell's place on hover or focus.
 */
export function PartColumnsRow({
    id,
    title,
    onOpen,
    name,
    project,
    cost,
    state,
    action,
}: {
    /** The part's item, named as `data-part`. */
    id: string;
    /** The part in full, as the button's tooltip. */
    title: string;
    /** Called as the reader opens the part's item. */
    onOpen: () => void;
    /** The part's name, a PartName. */
    name: ReactNode;
    /** Its project, when it isn't the concept's own. */
    project?: ReactNode;
    /** Its agent figures (time, tokens and cost), right-aligned beside its state, on one line. */
    cost?: ReactNode;
    /** Its one state word. */
    state: ReactNode;
    /** What it asks next, such as Open thread, over its state on hover or focus. */
    action?: ReactNode;
}) {
    return (
        <li
            data-part={id}
            data-part-columns
            className="hover:bg-fill-hover group/part relative col-span-full grid grid-cols-subgrid rounded-lg px-3 py-0.5"
        >
            <button
                type="button"
                data-row-open
                onClick={onOpen}
                title={title}
                className={`col-span-full grid min-h-6 grid-cols-subgrid items-center rounded-xs text-left ${ROW_OPENS}`}
            >
                <span className="flex min-w-0">{name}</span>
                <span className="text-fg-soft flex max-w-32 min-w-0 text-xs" data-part-project>
                    {project}
                </span>
                <span className="text-fg-soft text-right text-xs whitespace-nowrap tabular-nums" data-part-cost>
                    {cost}
                </span>
                <span
                    className={`text-fg-soft max-w-40 truncate text-right text-xs whitespace-nowrap ${action ? 'group-focus-within/part:invisible group-hover/part:invisible group-has-[[aria-expanded=true]]/part:invisible' : ''}`}
                    data-part-state
                >
                    {state}
                </span>
            </button>
            {action && (
                <span
                    data-part-hover-action
                    className="text-fg-muted pointer-events-none absolute inset-y-0 right-3 flex items-center justify-end gap-2 text-xs opacity-0 group-focus-within/part:pointer-events-auto group-focus-within/part:opacity-100 group-hover/part:pointer-events-auto group-hover/part:opacity-100 group-has-[[aria-expanded=true]]/part:pointer-events-auto group-has-[[aria-expanded=true]]/part:opacity-100"
                >
                    {action}
                </span>
            )}
        </li>
    );
}
