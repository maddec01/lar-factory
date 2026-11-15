// An expanded dossier's attention list: what keeps its work moving, as labelled rows of entries, and the parts and
// references its entries name.

import { StatusIndicator } from '@lar-works/design-system';
import { BanIcon, CheckIcon, CircleHelpIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import { COMPACT_ROW, pickedRow, ROW_OPENS } from './RowStyles';
import { type AttentionTone, attentionToneState } from './StatusColors';
import { GroupTitle } from './TextParts';

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
        // Each label sits over its entries, which take the full width and start on the parts' column.
        <dl className="m-0 grid grid-cols-1 gap-y-1" data-attention>
            {rows.map((r) => (
                <div key={r.key} className="contents" data-attention-row={r.key}>
                    <dt className="self-start pt-2 whitespace-nowrap">
                        <GroupTitle>
                            {r.tone !== 'fog' && <StatusIndicator size="sm" state={attentionToneState[r.tone]} />}
                            <span>
                                {r.label} <span className="tabular-nums">{r.entries.length}</span>
                            </span>
                        </GroupTitle>
                    </dt>
                    <dd className="m-0 grid gap-1">{r.entries}</dd>
                </div>
            ))}
        </dl>
    );
}

/** One entry of an attention row, with what it waits on or its next action at the right. */
export function AttentionEntry({
    main,
    side,
    picked = false,
}: {
    /** The entry's text, such as a PartLink. */
    main: ReactNode;
    /** The item it names is the one the dialog shows now. */
    picked?: boolean;
    /** What it waits on or its next action, at the right. */
    side?: ReactNode;
}) {
    return (
        // Its text on the column's edges, its hover fill reaching past them, as a row's does.
        <div
            className={`${COMPACT_ROW} ${pickedRow(picked)} -mx-2 flex min-h-7 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1`}
        >
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
        // An open question reads a step quieter than the parts above it, but above the notes and states beside it.
        <span
            {...data}
            className={`flex ${clamp ? 'min-w-0 ' : ''}items-start gap-1.5 text-sm ${mark === 'fog' ? 'text-fg-soft' : ''}`}
        >
            {MARKS[mark]}
            <span className={clamp ? 'line-clamp-2' : undefined}>{children}</span>
        </span>
    );
}

/** A part as a button that opens it: its identity (PartIdentity, a row's glyph, title and source cells) on one line, as
 *  its parts-list row names it; the title says it whole on hover. */
export function PartLink({
    onOpen,
    children,
}: {
    /** Called as the reader opens the part. */
    onOpen: () => void;
    /** The part's PartIdentity. */
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`flex max-w-full min-w-0 items-center gap-3 rounded-xs text-left text-xs ${ROW_OPENS}`}
            data-part-link
        >
            {children}
        </button>
    );
}

/** A part's state when it waits on you, in amber, as its desk card and its parent's row say it. */
export function WaitWord({
    children,
}: {
    /** The wait in words, such as "Question". */
    children: ReactNode;
}) {
    return <span className="text-warning-fg font-medium whitespace-nowrap">{children}</span>;
}
