// Lar Factory's Add item: the title bar's button that opens it, the New work pane's fields beside their details panel,
// the panel's labelled fields and ticket part, the Create issue choice, and the Find a ticket pane with its search.

import { FormResult, TitleBarLabel, Tooltip, TooltipPopup, TooltipTrigger, tabbable } from '@lar-works/design-system';
import { SquarePenIcon } from '@lar-works/design-system/icons';
import {
    ButtonBase as Button,
    FormFieldsetBase,
    InputBase,
    scrollFadeClassName,
    useScrollFade,
} from '@lar-works/design-system/primitives';
import type { KeyboardEvent, ReactNode, Ref } from 'react';

import { buttonKind } from './ButtonKinds';
import { DetailsHeading } from './ItemDetailSections';

/** The title bar's Add item button, a Main action named by its `label`, which folds away, for screen readers only, on a
 *  title bar under 72rem; `title` gives it whole with its shortcut in a glass tooltip, which `keyShortcuts` names.
 *  Before the first project it `waits`, an Other, so adding a project is the board's one Main action. */
export function AddItemButton({
    label,
    title,
    keyShortcuts,
    waits = false,
    onOpen,
}: {
    /** The button's text, such as "Add item". */
    label: string;
    /** The tooltip, which gives its shortcut. */
    title: string;
    /** The shortcut, for `aria-keyshortcuts`. */
    keyShortcuts?: string;
    /** An outline, not the fill: the title bar's Add item, which a page's own next step (an empty board's) outranks. */
    waits?: boolean;
    /** Called as the reader opens the add-item dialog. */
    onOpen: () => void;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    {...buttonKind(waits ? 'other' : 'main')}
                    className="add-item"
                    leftIcon={<SquarePenIcon />}
                    aria-keyshortcuts={keyShortcuts}
                    onClick={onOpen}
                >
                    <TitleBarLabel>{label}</TitleBarLabel>
                </Button>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{title}</TooltipPopup>
        </Tooltip>
    );
}

/** The top of Add item's body: the switch between its panes, then what the shown pane does, muted, on one line, so the
 *  dialog's header keeps to its title and window controls. */
export function AddItemModes({
    description,
    children,
}: {
    /** What the shown pane does, such as "Record work in lar-server and add it to List." */
    description: ReactNode;
    /** The panes' switch. */
    children: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 sm:px-6" data-add-item-modes>
            {children}
            <span className="text-fg-muted min-w-0 text-sm">{description}</span>
        </div>
    );
}

/**
 * A draft's fields as one group, which `disabled` locks: the `main` column (its title, editor and notes) beside the
 * `details` panel, which `detailsLabel` names. Narrower than 40rem the panel stacks under the main column, which then
 * grows with its text, and the two scroll as one; each row sizes to its content, so the body scrolls while the footer stays outside it. On wide dialogs each column
 * scrolls independently, so the Project and Kind controls stay beside long descriptions.
 */
export function DraftFields({
    id,
    disabled,
    detailsLabel,
    main,
    details,
}: {
    /** The group's id, for the form's controls outside it. */
    id: string;
    /** Locks every field, such as while the draft saves. */
    disabled: boolean;
    /** Names the details panel for screen readers. */
    detailsLabel: string;
    /** The main column: the title, editor and notes. */
    main: ReactNode;
    /** The details panel beside it. */
    details: ReactNode;
}) {
    // Whichever region scrolls at this width (the whole draft on a narrow pane, else each column) fades at its edges.
    const { setViewport: draftRef } = useScrollFade();
    const { setViewport: mainFadeRef } = useScrollFade();
    const { setViewport: detailsFadeRef } = useScrollFade();

    return (
        <div className="@container flex min-h-0 flex-1 flex-col">
            <FormFieldsetBase
                id={id}
                presentation="group"
                disabled={disabled}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
                <div
                    ref={draftRef}
                    data-draft-scroll
                    className={`@max-pane:grid-cols-[minmax(0,1fr)] @max-pane:auto-rows-max @max-pane:content-start @max-pane:overflow-y-auto grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem] overflow-hidden ${scrollFadeClassName}`}
                >
                    <div
                        ref={mainFadeRef}
                        className={`@max-pane:min-h-80 @max-pane:overflow-visible flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pt-4 pb-5 ${scrollFadeClassName}`}
                    >
                        {main}
                    </div>
                    <aside
                        ref={detailsFadeRef}
                        aria-label={detailsLabel}
                        className={`border-line bg-surface-page/60 @max-pane:overflow-visible @max-pane:border-t @max-pane:border-l-0 grid grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto border-l px-6 py-4 ${scrollFadeClassName}`}
                    >
                        {details}
                    </aside>
                </div>
            </FormFieldsetBase>
        </div>
    );
}

/**
 * A field of a details panel under its sentence-case `heading`, which labels the field `htmlFor` names; without
 * `htmlFor`, the field is a group of controls that the heading names, such as a ticket's labels (`id` and `ref` reach
 * the group).
 */
export function PanelField({
    heading,
    htmlFor,
    id,
    ref,
    children,
}: {
    /** The field's sentence-case heading. */
    heading: string;
    /** The id of the control the heading labels; without it, the field is a group the heading names. */
    htmlFor?: string;
    /** The field's id. */
    id?: string;
    /** The field's element, for moving focus to it. */
    ref?: Ref<HTMLDivElement>;
    /** The field's control or controls. */
    children: ReactNode;
}) {
    if (htmlFor)
        return (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
                <DetailsHeading presentation="field" as="label" htmlFor={htmlFor}>
                    {heading}
                </DetailsHeading>
                {children}
            </div>
        );

    return (
        <div
            ref={ref}
            id={id}
            role="group"
            aria-label={heading}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5"
        >
            <DetailsHeading presentation="field" as="span">
                {heading}
            </DetailsHeading>
            {children}
        </div>
    );
}

/** The details panel's ticket part, ruled off from the fields above it: a ticket's own fields, or what a draft without
 *  one keeps. */
export function DraftTicketPart({
    children,
}: {
    /** The ticket's own fields, or what a draft without one keeps. */
    children: ReactNode;
}) {
    return <div className="border-line grid gap-3 border-t pt-4">{children}</div>;
}

/** Create issue in the footer: its `checkbox`, then the `reason` it can't be ticked, kept to a readable width, and any
 *  `error`. */
export function CreateIssueChoice({
    checkbox,
    reason,
    error,
}: {
    /** The Create issue checkbox. */
    checkbox: ReactNode;
    /** Why it can't be ticked, under it. */
    reason?: ReactNode;
    /** Why creating the issue failed, announced. */
    error?: ReactNode;
}) {
    return (
        <div className="grid gap-1">
            {checkbox}
            {reason && <div className="max-w-md">{reason}</div>}
            {error}
        </div>
    );
}

/** The Find a ticket pane, ruled off from the header: its notes and fields, one under the other, scrolling above the
 *  footer when a long result list needs it. */
export function TicketSearchPane({
    id,
    children,
}: {
    /** The pane's id, for the control that opens it. */
    id: string;
    /** The pane's notes and fields. */
    children: ReactNode;
}) {
    const { setViewport: fadeRef } = useScrollFade();

    return (
        <div
            ref={fadeRef}
            id={id}
            className={`grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto px-5 pt-4 pb-5 sm:px-6 ${scrollFadeClassName}`}
        >
            {children}
        </div>
    );
}

/** A ticket a search found: its number, its title and a short `note`, such as that it is on the board already. */
export interface TicketSearchMatch {
    number: number;
    title: string;
    note?: string | undefined;
}

/**
 * A search of a tracker's open tickets: the field (`fieldLabel` names it) with its Search button, which Enter also
 * runs, the matches, each a button that picks it, and the search's `result`, announced. `id` prefixes the field's,
 * the button's and the result's ids. `busy` stops a pick while a search or a pick runs, and `picking` marks the list
 * as busy.
 */
export function TicketSearch({
    id,
    query,
    onQueryChange,
    onSearch,
    fieldLabel,
    placeholder,
    searchLabel,
    disabled = false,
    searchDisabled = false,
    tickets,
    listLabel,
    busy = false,
    picking = false,
    onPick,
    result,
}: {
    /** The search field's id. */
    id: string;
    /** The field's text. */
    query: string;
    /** Called with the field's text as the reader types. */
    onQueryChange: (query: string) => void;
    /** Called as the reader runs the search, by the button or Enter. */
    onSearch: () => void;
    /** Names the search field. */
    fieldLabel: string;
    /** The field's placeholder. */
    placeholder: string;
    /** The search button's text, such as "Search". */
    searchLabel: string;
    /** Locks the field and its button. */
    disabled?: boolean | undefined;
    /** Locks the search button alone, such as while the field is empty. */
    searchDisabled?: boolean;
    /** The matching tickets, each a button that picks it. */
    tickets: readonly TicketSearchMatch[];
    /** Names the list of matches. */
    listLabel: string;
    /** A search is in flight. */
    busy?: boolean;
    /** A picked ticket is being attached: the matches are locked. */
    picking?: boolean;
    /** Called with a ticket's number as the reader picks it. */
    onPick: (number: number) => void;
    /** What the search found, announced, such as "3 tickets". */
    result: string;
}) {
    const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;

        event.preventDefault();
        onSearch();
    };

    return (
        <div className="grid gap-2" data-ticket-picker>
            <div className="flex gap-2">
                <InputBase
                    id={`${id}-query`}
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.currentTarget.value)}
                    onKeyDown={onKey}
                    disabled={disabled}
                    autoComplete="off"
                    aria-label={fieldLabel}
                    placeholder={placeholder}
                    className="min-w-0 flex-1"
                />
                <Button
                    {...buttonKind('other')}
                    size="md"
                    id={`${id}-search`}
                    disabled={disabled || searchDisabled}
                    onClick={onSearch}
                >
                    {searchLabel}
                </Button>
            </div>
            {tickets.length > 0 && (
                <ul className="m-0 grid list-none gap-0.5 p-0" aria-label={listLabel} aria-busy={picking}>
                    {tickets.map((ticket) => (
                        <li key={ticket.number}>
                            <button
                                {...tabbable}
                                type="button"
                                data-ticket={ticket.number}
                                disabled={busy}
                                onClick={() => onPick(ticket.number)}
                                className="hover:bg-fill-hover focus-ring flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-60"
                            >
                                <span className="text-fg-muted shrink-0 tabular-nums">#{ticket.number}</span>
                                <span className="min-w-0 flex-1 truncate">{ticket.title}</span>
                                {ticket.note && <span className="text-fg-muted shrink-0 text-xs">{ticket.note}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <FormResult id={`${id}-result`} text={result} />
        </div>
    );
}
