import { Badge, Loading, SectionTitle, SidebarNavigationItem } from '@lar-works/design-system';
import { ButtonBase as Button } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { buttonKind } from './ButtonKinds';

interface ListButtonProps {
    /** The button's text, such as "List". */
    label: string;
    /** The button's icon. */
    icon: ReactNode;
    /** How many items are in List; none while the first read could still add some, which shows a loading cue. */
    count: number | undefined;
    /** What the count says while it loads. */
    loadingLabel: string;
    /** Called as the reader opens the List. */
    onOpen: () => void;
}

/** The title bar's List button, "List <count>": an App control whose label folds away, for screen readers only, on a
 *  title bar under 70rem. */
export function ListButton({ label, icon, count, loadingLabel, onOpen }: ListButtonProps) {
    return (
        <Button {...buttonKind('control')} className="list-button px-2" leftIcon={icon} title={label} onClick={onOpen}>
            <span className="@max-6xl:sr-only">{label}</span>
            {count === undefined ? <Loading presentation="inline" title={loadingLabel} /> : <Badge>{count}</Badge>}
        </Button>
    );
}

/** A group in the List's left pane: its icon, its name and how many of its items match; a group still reading shows
 *  no count. */
export function ListGroupItem({
    label,
    count,
    icon,
    active,
    onPick,
}: {
    /** The group's name. */
    label: string;
    /** How many of its items match; none while it reads. */
    count?: number;
    /** The group's icon. */
    icon: ReactNode;
    /** The group shown now. */
    active: boolean;
    /** Called as the reader picks the group. */
    onPick: () => void;
}) {
    return (
        <SidebarNavigationItem active={active} onClick={onPick}>
            {icon}
            <span className="name min-w-0 flex-1 truncate text-left">{label}</span>
            {count !== undefined && <span className="count text-fg-muted text-xs tabular-nums">{count}</span>}
        </SidebarNavigationItem>
    );
}

interface ListHeaderProps {
    /** The search field, and beside it Add item. */
    search: ReactNode;
    /** The search with Add item. */
    add: ReactNode;
    /** The chosen group's name and how many of its items show; no count while it's still reading. */
    title: string;
    /** How many items the chosen group holds. */
    count?: number;
    /** After the count: a toggle that scopes the board to the group, and at the right the sort menu. */
    scope?: ReactNode;
    /** The scope toggle and sort. */
    sort: ReactNode;
    /** The filters, a FilterBar. */
    filters: ReactNode;
}

/** The List's right pane's head: the search with Add item, then the chosen group with its count, scope toggle and sort,
 *  then the filters. */
export function ListHeader({ search, add, title, count, scope, sort, filters }: ListHeaderProps) {
    return (
        <div className="flex shrink-0 flex-col gap-2 px-5 sm:px-6">
            <div className="flex items-center gap-2 [&>[data-slot=button]]:shrink-0">
                {search}
                {add}
            </div>
            <div className="flex min-w-0 items-center gap-2">
                <SectionTitle title={title} count={count} />
                {scope}
                <span className="sort ml-auto">{sort}</span>
            </div>
            {filters}
        </div>
    );
}

interface ListItemRowProps {
    /** The item's id, as `data-item`. */
    item: string;
    /** Its title in full, for the tooltip. */
    name: string;
    /** Called as the reader opens the item dialog. */
    onOpen: () => void;
    /** Where the item comes from. */
    source: ReactNode;
    /** The ticket's reference, such as "#61", before the title; none for an item with no ticket. */
    reference?: string;
    /** The item's title. */
    title: string;
    /** The repository's icon, when the list mixes repositories, and the meta line's text: its name and age. */
    repoIcon?: ReactNode;
    /** The item's facts on one line. */
    meta: string;
    /** After the meta line: the item's kind, labels and sync state. */
    chips?: ReactNode;
    /** More under the meta line, such as a work item's fields. */
    details?: ReactNode;
}

/** An item in the List's right pane, opening the item dialog. */
export function ListItemRow({
    item,
    name,
    onOpen,
    source,
    reference,
    title,
    repoIcon,
    meta,
    chips,
    details,
}: ListItemRowProps) {
    return (
        <button
            type="button"
            onClick={onOpen}
            data-item={item}
            title={name}
            className="hover:bg-fill-hover focus-ring-inset flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left"
        >
            {source}
            <span className="min-w-0 flex-1">
                <span className="text-fg text-ui block truncate leading-5 font-medium">
                    {reference ? <span className="text-fg-muted font-normal">{reference} </span> : null}
                    {title}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="text-fg-muted text-2xs me-1 flex min-w-0 items-center gap-1 leading-4">
                        {repoIcon}
                        <span className="min-w-0 truncate tabular-nums">{meta}</span>
                    </span>
                    {chips}
                </span>
                {details}
            </span>
        </button>
    );
}

/** What the List says in place of items: nothing matches, nothing in List, or still loading. With `reading`, it
 *  follows items as more may arrive. */
export function ListNote({
    children,
    reading = false,
}: {
    /** What the List says, such as "Nothing matches". */
    children: ReactNode;
    /** More items may still arrive: the note follows them. */
    reading?: boolean;
}) {
    return (
        <p className={`text-fg-muted m-0 p-4 text-sm ${reading ? '' : 'empty'}`} data-reading={reading || undefined}>
            {children}
        </p>
    );
}
