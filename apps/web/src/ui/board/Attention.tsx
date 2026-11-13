// An expanded dossier's attention list: what keeps its work moving, as labelled rows of entries, and the parts and
// references its entries name.

import { StatusIndicator } from '@lar-works/design-system';
import { BanIcon, CheckIcon, CircleHelpIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import { ROW_OPENS } from './RowStyles';
import { type AttentionTone, attentionToneState } from './StatusColors';

export type { AttentionTone };

/** The attention rows, each a top-aligned sentence-case label with its count, then its entries. A status dot carries
 *  the tone; open questions have no status dot. */
export function BoardAttentionList({
    rows,
}: {
    /** The attention rows, each with its label, tone and entries. */
    rows: { key: string; label: string; tone: AttentionTone; entries: ReactNode[] }[];
}) {
    return (
        // The labels' column is 7.5rem, or as wide as the longest label so none wraps ("To verify or merge" needs more).
        // On a phone each label sits on top of its entries, which take the full width.
        <dl
            className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)] sm:gap-y-2"
            data-attention
        >
            {rows.map((r) => (
                <div key={r.key} className="contents" data-attention-row={r.key}>
                    <dt className="text-fg-soft flex items-center gap-1.5 self-start pt-2 text-xs font-medium whitespace-nowrap">
                        {r.tone !== 'fog' && <StatusIndicator size="sm" state={attentionToneState[r.tone]} />}
                        <span>
                            {r.label} <span className="tabular-nums">{r.entries.length}</span>
                        </span>
                    </dt>
                    <dd className="m-0 grid gap-1">{r.entries}</dd>
                </div>
            ))}
        </dl>
    );
}

/** What the attention list says when nothing holds the work up. */
export function AttentionNone({
    children,
}: {
    /** What the list says, such as "Nothing holds this up". */
    children: ReactNode;
}) {
    return (
        <p className="text-fg-muted m-0 text-sm" data-attention-none>
            {children}
        </p>
    );
}

/** One entry of an attention row, with what it waits on or its next action at the right. */
export function AttentionEntry({
    main,
    side,
}: {
    /** The entry's text, such as a PartLink. */
    main: ReactNode;
    /** What it waits on or its next action, at the right. */
    side?: ReactNode;
}) {
    return (
        <div className="hover:bg-fill-hover flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5">
            <span className="min-w-0 flex-1 basis-64">{main}</span>
            {side && <span className="text-fg-muted ml-auto max-w-full min-w-0 text-xs wrap-anywhere">{side}</span>}
        </div>
    );
}

/** An entry's text as a plain button that opens what it names. */
export function EntryButton({
    onOpen,
    children,
}: {
    /** Called as the reader opens what the entry names. */
    onOpen: () => void;
    /** The entry's text. */
    children: ReactNode;
}) {
    return (
        <button type="button" onClick={onOpen}>
            {children}
        </button>
    );
}

/** A reference to an item, such as `#12`, as a button that opens it; `title` names it. */
export function RefButton({
    title,
    onOpen,
    children,
}: {
    /** Names the item in full, as the tooltip. */
    title: string;
    /** Called as the reader opens the item. */
    onOpen: () => void;
    /** The reference, such as `#12`. */
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            title={title}
            className="text-primary-fg hover:bg-fill-hover focus-ring rounded-xs font-medium tabular-nums"
        >
            {children}
        </button>
    );
}

const MARKS = {
    blocked: <BanIcon className="stroke-warning mt-0.5 size-3.5 shrink-0" />,
    met: <CheckIcon className="stroke-success mt-0.5 size-3.5 shrink-0" />,
    fog: <CircleHelpIcon className="text-fg-muted mt-0.5 size-3.5 shrink-0" />,
} as const;

/** An entry's text after a mark: blocked, met, or an open question (fog). `clamp` keeps it to two lines. */
export function AttentionMark({
    mark,
    clamp = false,
    children,
    ...data
}: {
    /** The mark: `blocked`, `met` or `fog` for an open question. */
    mark: keyof typeof MARKS;
    /** Keeps the text to two lines. */
    clamp?: boolean;
    /** The entry's text. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <span {...data} className={`flex ${clamp ? 'min-w-0 ' : ''}items-start gap-1.5 text-sm`}>
            {MARKS[mark]}
            <span className={clamp ? 'line-clamp-2' : undefined}>{children}</span>
        </span>
    );
}

/** A part's status glyph, source and title, in that order, the title up to two lines. */
export function PartName({
    source,
    glyph,
    children,
}: {
    /** Where the part's ticket is saved, as a SourceIcon. */
    source: ReactNode;
    /** The part's status glyph. */
    glyph: ReactNode;
    /** The part's title. */
    children: ReactNode;
}) {
    return (
        <span className="flex min-w-0 items-start gap-1.5 text-sm">
            <span className="mt-0.5 inline-flex shrink-0">{glyph}</span>
            {source}
            <span className="line-clamp-2 min-w-0 flex-1" data-part-title>
                {children}
            </span>
        </span>
    );
}

/** A part's PartName as a button that opens it; `title` names it. */
export function PartLink({
    title,
    onOpen,
    children,
}: {
    /** Names the part in full, as the tooltip. */
    title: string;
    /** Called as the reader opens the part. */
    onOpen: () => void;
    /** The part's PartName. */
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            title={title}
            className={`min-w-0 rounded-xs text-left hover:underline ${ROW_OPENS}`}
        >
            {children}
        </button>
    );
}
