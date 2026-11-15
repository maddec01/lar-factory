import {
    Badge,
    Loading,
    SidebarNavigationItem,
    TitleBarLabel,
    Tooltip,
    TooltipPopup,
    TooltipTrigger,
} from '@lar-works/design-system';
import { ButtonBase as Button, useScrollFade } from '@lar-works/design-system/primitives';
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
 *  title bar under 72rem, where its glass tooltip names it. */
export function ListButton({ label, icon, count, loadingLabel, onOpen }: ListButtonProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button {...buttonKind('control')} className="list-button" leftIcon={icon} onClick={onOpen}>
                    <TitleBarLabel>{label}</TitleBarLabel>
                    {count === undefined ? (
                        <Loading presentation="inline" title={loadingLabel} />
                    ) : (
                        <Badge>{count}</Badge>
                    )}
                </Button>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{label}</TooltipPopup>
        </Tooltip>
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
    /** The search field. */
    search: ReactNode;
    /** Add item, at the search field's 32px (`md`), at the row's end. */
    add: ReactNode;
    /** A toggle that scopes the board to the chosen project; none for All projects. The left pane already names and
     *  counts the chosen group, so the head repeats neither. */
    scope?: ReactNode;
    /** The sort menu. */
    sort: ReactNode;
    /** The filters, a FilterBar. */
    filters: ReactNode;
}

/** The List's right pane's head, fixed above its scrolling results (under the dialog's 52px header and its hairline,
 *  on the body's own inset): one row of the search, then the filters, the scope toggle and the sort, then Add item at
 *  its end. A pane too narrow for one row takes the controls and Add item onto a second, the search keeping the first
 *  whole. */
export function ListHeader({ search, add, scope, sort, filters }: ListHeaderProps) {
    return (
        <div
            className="flex shrink-0 flex-wrap items-center gap-2 pb-2 [&>[data-slot=button]]:ml-auto [&>[data-slot=button]]:shrink-0"
            data-list-head
        >
            <div className="min-w-40 flex-[1_1_10rem]">{search}</div>
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-list-controls>
                {filters}
                {scope}
                <span className="sort">{sort}</span>
            </div>
            {add}
        </div>
    );
}

/** The List's results under its fixed head: the rows scroll here, alone, so the search, filters and sort stay in
 *  reach however far the reader goes. Its 12px side inset holds the rows' hover fill, which reaches past the text; its
 *  edges fade where rows run past them, so no row ends in a hard cut. */
export function ListResults({
    children,
}: {
    /** The rows, or what the List says in their place. */
    children: ReactNode;
}) {
    const { setViewport, className } = useScrollFade();

    return (
        <div
            ref={setViewport}
            className={`@container relative -mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 ${className}`}
            data-list-results
        >
            {children}
        </div>
    );
}

/** Each set of the List's columns as whole class names, as Tailwind only finds those: the kind and source marks, the
 *  title, then the labels sized to the widest row's up to 12rem (a tag of at most 10rem and its "+n"), the project to the
 *  longest name up to 8rem, and the age. */
const COLUMNS = {
    labelsProject: 'grid-cols-[2.5rem_minmax(0,1fr)_fit-content(12rem)_fit-content(8rem)_3.5rem]',
    labels: 'grid-cols-[2.5rem_minmax(0,1fr)_fit-content(12rem)_3.5rem]',
    project: 'grid-cols-[2.5rem_minmax(0,1fr)_fit-content(8rem)_3.5rem]',
    none: 'grid-cols-[2.5rem_minmax(0,1fr)_3.5rem]',
} as const;

/** The List's rows on one grid, each row a subgrid of it, so its labels, project and age columns start at one place on
 *  every row and are only as wide as their widest cell, leaving the rest to the titles. */
export function ListRowGrid({
    labels,
    project,
    children,
}: {
    /** Some row has labels: the rows have a labels column. */
    labels: boolean;
    /** The rows name their project: they have a project column. */
    project: boolean;
    /** The rows, ListItemRows. */
    children: ReactNode;
}) {
    const columns = COLUMNS[labels ? (project ? 'labelsProject' : 'labels') : project ? 'project' : 'none'];

    return (
        <div className={`grid content-start gap-x-3 ${columns}`} data-list-rows>
            {children}
        </div>
    );
}

interface ListItemRowProps {
    /** The item's id, as `data-item`. */
    item: string;
    /** Its title in full, and any facts its row leaves out (such as a work item's state and assignee), for the
     *  tooltip. */
    name: string;
    /** Called as the reader opens the item dialog. */
    onOpen: () => void;
    /** Where the item comes from. */
    source: ReactNode;
    /** The ticket's reference, such as "#61", before the title; none for an item with no ticket. */
    reference?: string;
    /** The item's title. */
    title: string;
    /** The repository's icon, when the list mixes repositories. */
    repoIcon?: ReactNode;
    /** The repository's name, in its own column before the age, when the list mixes repositories; empty otherwise. */
    meta: string;
    /** How long ago it changed, at the row's end. */
    age?: string;
    /** Some row in the list has labels: the rows have a labels column, so labels start at one place down the list; a row
     *  with none gives its cell to its title. */
    labelColumn?: boolean;
    /** Its labels' names; the first shows as `chip`, the rest as "+n", which names them all on hover. */
    labels?: readonly string[];
    /** Its first label as a quiet outlined tag, so a tag such as "Blocked" never reads as a board state. */
    chip?: ReactNode;
    /** A quiet note before the labels, such as planning saved only on this Mac. */
    note?: ReactNode;
}

/** An item in the List's right pane, opening the item dialog, on a ListRowGrid's columns: one line, as a board row
 *  reads. Its kind and source, its number and title (truncating first) and any note; then its labels, its project and
 *  its age, each in a column of its own, so they line up down the list whatever the title. In the labels column, left
 *  aligned, its first tag as a quiet chip as wide as its name up to 10rem, so a title gives way before it does,
 *  truncating past that, with "+n" for the rest, which names them all on hover, at every width; the row's tooltip names
 *  them too. A tracker's colour dot is mixed toward the text colour in light, so a pale one still shows on a light
 *  page. A row with no labels gives their cell to its title. Every row has one height. */
export function ListItemRow({
    item,
    name,
    onOpen,
    source,
    reference,
    title,
    repoIcon,
    meta,
    age,
    labelColumn = false,
    labels = [],
    chip,
    note,
}: ListItemRowProps) {
    const more = labels.slice(1);

    return (
        <button
            type="button"
            onClick={onOpen}
            data-item={item}
            title={name}
            className="list-row hover:bg-fill-hover focus-ring-inset col-span-full -mx-3 grid h-9 min-w-0 grid-cols-subgrid items-center rounded-lg px-3 text-left whitespace-nowrap"
        >
            {/* Room for a kind and a source mark, so every title starts on one line down the list. */}
            <span className="text-fg-muted flex items-center gap-2">{source}</span>
            {/* With no labels of its own, the title takes the labels' empty cell too. */}
            <span className={`flex min-w-0 items-center gap-3 ${labelColumn && !labels.length ? 'col-span-2' : ''}`}>
                <span className="text-fg min-w-0 flex-1 truncate text-sm">
                    {reference ? <span className="text-fg-muted">{reference} </span> : null}
                    {title}
                </span>
                {note && (
                    <span className="text-fg-muted max-w-48 shrink-0 truncate text-xs" data-row-note>
                        {note}
                    </span>
                )}
            </span>
            {labelColumn && labels.length > 0 && (
                <span
                    className="text-fg-muted [&_[data-label-chip]]:text-fg-muted flex min-w-0 items-center gap-1.5 text-xs [&_[data-label-chip]]:bg-transparent [&_[data-label-chip]]:font-normal [&_[data-label-chip]_[style*='--status-dot']]:bg-[color-mix(in_oklab,var(--status-dot)_60%,var(--color-fg))] dark:[&_[data-label-chip]_[style*='--status-dot']]:bg-(--status-dot)"
                    title={labels.join('\n')}
                    data-row-labels
                >
                    {chip && <span className="flex max-w-40 min-w-0">{chip}</span>}
                    {more.length > 0 && <span className="shrink-0 tabular-nums">+{more.length}</span>}
                </span>
            )}
            {/* Its project in a column of its own, so it starts at one place on every row. */}
            {meta && (
                <span className="text-fg-soft flex min-w-0 items-center gap-1.5 text-xs" data-row-project>
                    {repoIcon}
                    <span className="min-w-0 truncate">{meta}</span>
                </span>
            )}
            <span className="text-fg-muted text-right text-xs tabular-nums">{age}</span>
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
