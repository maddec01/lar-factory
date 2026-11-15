import type { WorkMapPrerequisite } from '@lar-factory/shared';
import { FlaskConicalIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { BoardCard } from './BoardCard';
import { MapStartAction } from './StartAfterButton';

/** Room for a wrapping action header, a project line, two title lines, status and slices; edges share this height. */
export const MAP_NODE_HEIGHT = 156;

/** Each need's tone on the board's card (items.css), as a desk card wears it. */
const NODE_TONE = {
    default: undefined,
    asks: 'waiting',
    waits: 'held',
} as const;

/**
 * A part on the map, `width` by `height`: a card that opens it (`openLabel` names the button, `title` says it all),
 * with its `source` in the corner, a `head` line (kind, repository, fields) with its `action` at the right, its title,
 * its `glyph` and `facts`, and its `slices` along the bottom. It `asks` (an answer from you) or `waits` (on other work)
 * in its border (the attention recipe, as a desk card), and takes the current edge while `picked`.
 */
export function MapPartNode({
    id,
    width,
    height,
    attention = 'default',
    tone,
    picked,
    openLabel,
    title,
    onOpen,
    source,
    head,
    repository,
    action,
    name,
    glyph,
    facts,
    slices,
    recordState,
    waitReason,
    track,
}: {
    /** The part's item, named as `data-item`. */
    id: string;
    /** The card's width in pixels. */
    width: number;
    /** The card's height in pixels. */
    height: number;
    /** What the part needs: `asks` an answer from you, `waits` on other work, or `default` neither. */
    attention?: keyof typeof NODE_TONE;
    /** Its leading bar when it needs nothing: `done`, or `active` while its thread works. */
    tone?: 'done' | 'active' | undefined;
    /** The item the dialog shows now. */
    picked: boolean;
    /** The card button's accessible name. */
    openLabel: string;
    /** The part in full, as its tooltip. */
    title: string;
    /** Called as the reader opens the part. */
    onOpen: () => void;
    /** Where its ticket is saved, in the corner. */
    source: ReactNode;
    /** The card's head line, such as its repository. */
    head: ReactNode;
    /** A project name on its own bounded line, outside the action row. */
    repository?: ReactNode;
    /** What it asks next. */
    action?: ReactNode;
    /** The part's name. */
    name: ReactNode;
    /** The part's status glyph. */
    glyph: ReactNode;
    /** Its facts on one line. */
    facts: string;
    /** Queue and gate facts from the current work record. */
    recordState: string;
    /** Every current wait, available without truncation on hover. */
    waitReason: string;
    /** Its slices, a SliceBar. */
    slices?: ReactNode;
    /** Where it stands in its workflow, a StageTrack, at its head's end as on a desk card's foot. */
    track?: ReactNode;
}) {
    // The board's one card, as Your desk composes it: the same head, title, foot and action in the same places.
    return (
        <BoardCard
            style={{ width, height }}
            data-map-part={id}
            tone={NODE_TONE[attention] ?? tone}
            picked={picked}
            onOpen={onOpen}
            openLabel={openLabel}
            tooltip={[title, recordState, waitReason].filter(Boolean).join(' · ')}
            head={
                <>
                    {source}
                    <span className="flex min-w-0 items-center gap-x-2" data-map-head>
                        {head}
                        {repository}
                    </span>
                </>
            }
            track={track}
            name={name}
            sub={
                <>
                    {recordState && (
                        <span className="min-w-0 truncate" data-map-record-state>
                            {recordState}
                        </span>
                    )}
                </>
            }
            state={
                <>
                    {attention !== 'asks' && glyph}
                    <span className={`min-w-0 truncate ${attention === 'asks' ? '' : 'text-fg'}`} data-map-facts>
                        {facts}
                    </span>
                </>
            }
            action={action && <MapStartAction>{action}</MapStartAction>}
            bottom={slices && <span className="shrink-0">{slices}</span>}
        />
    );
}

/** The end-to-end check at the end of the map, `width` by `height`: its `label`, title, then its `glyph` and `steps`
 *  (how many, and what it comes after), which `stepsTitle` says in full. */
export function MapCheckNode({
    width,
    height,
    label,
    title,
    glyph,
    steps,
    stepsTitle,
}: {
    /** The card's width in pixels. */
    width: number;
    /** The card's height in pixels. */
    height: number;
    /** The check's label, such as "End to end". */
    label: string;
    /** The check's title. */
    title: string;
    /** The check's status glyph. */
    glyph: ReactNode;
    /** How many steps, and what it comes after. */
    steps: string;
    /** The steps in full, as their tooltip. */
    stepsTitle?: string | undefined;
}) {
    return (
        <div
            style={{ width, height }}
            data-map-check
            className="board-card flex flex-col gap-1 px-3 py-2.5"
            data-card-tone="held"
        >
            <span className="text-fg-muted flex items-center gap-1.5 text-xs">
                <FlaskConicalIcon className="size-3.5" />
                {label}
            </span>
            <span className="line-clamp-2 text-sm leading-5">{title}</span>
            <span className="mt-auto flex min-w-0 items-center gap-1.5 text-xs">
                {glyph}
                <span className="min-w-0 truncate" title={stepsTitle}>
                    {steps}
                </span>
            </span>
        </div>
    );
}

/** A recorded prerequisite outside the group, distinct from one of its parts. */
export function MapPrerequisiteNode({ prerequisite, width }: { prerequisite: WorkMapPrerequisite; width: number }) {
    const { blocker, kind, title, id } = prerequisite;
    const state =
        kind === 'dependency'
            ? blocker.dependency?.met
                ? 'Accepted as met'
                : blocker.dependency?.proofState === 'submitted'
                  ? 'Waiting for acceptance as met'
                  : blocker.dependency?.proofState === 'insufficient'
                    ? 'Proof insufficient · waiting'
                    : 'Waiting for proof'
            : blocker.state === 'closed'
              ? 'Complete'
              : 'Waiting for completion';

    return (
        <div
            data-map-prerequisite={id}
            data-prerequisite-kind={kind}
            className="board-card flex flex-col gap-2 px-3 py-2.5 text-sm"
            data-card-tone="held"
            style={{ width, height: MAP_NODE_HEIGHT }}
            title={`${title} · ${state}`}
        >
            <span className="text-fg-muted text-xs">
                {kind === 'dependency' ? 'Dependency' : 'Work outside this group'}
            </span>
            <span className="line-clamp-3 wrap-anywhere">{title}</span>
            <span className="text-fg-muted mt-auto text-xs">{state}</span>
        </div>
    );
}
