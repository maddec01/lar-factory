import type { WorkMapPrerequisite } from '@lar-factory/shared';
import { FlaskConicalIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { BoardCard } from './BoardCard';
import { MapStartAction } from './StartAfterButton';

/** A map card's height before its cards are measured: its head (kind, step and track), a three-line title and its
 *  foot, with the card's 8px padding and hairline. The map then makes every card as tall as its tallest needs
 *  (measureMapCards), so edges line up and no card is taller than what the map's cards say. */
export const MAP_NODE_HEIGHT = 142;

/**
 * How tall the map's tallest card needs to be: each card under `root` measured at its content's height (its lines under
 * the title, its slices), then put back at its fixed height, before the map paints; MAP_NODE_HEIGHT with no cards.
 */
export function measureMapCards(root: HTMLElement | null): number {
    const cards = root ? [...root.querySelectorAll<HTMLElement>('[data-map-card]')] : [];

    if (!cards.length) return MAP_NODE_HEIGHT;

    return Math.max(
        ...cards.map((card) => {
            const height = card.style.height;

            card.style.height = 'auto';

            const natural = card.offsetHeight;

            card.style.height = height;

            return natural;
        }),
    );
}

/** Each need's tone on the board's card (items.css), as a desk card wears it. */
const NODE_TONE = {
    default: undefined,
    asks: 'waiting',
    waits: 'held',
} as const;

/**
 * A part on the map, `width` by `height`: a card that opens it (`openLabel` names the button, `title` says it all),
 * with a head line of its `kind`'s icon (named on hover), its `reference` ("#139" or "Part 15", in the one place on
 * every card) and its fields, then where it stands (`track`, no stage word, so the head never says a state the foot
 * contradicts), its title alone on up to three lines, and a foot with its `glyph` and `facts`, which its `action` takes
 * the place of on hover or focus (items.css), and its `slices` along the bottom. Under the title, quiet, its reference,
 * another project's identity and its queue and gate facts share one line, and while its thread works, what it does now
 * takes a line of its own (`activity`). Its lane names its project. It `asks`
 * (an answer from you) or `waits` (on other work) in its border (the attention recipe, as a desk card), and takes the
 * current edge while `picked`. A `held` card, blocked or waiting on other work, keeps its step and track quiet (items.css),
 * so its foot says its one state.
 */
export function MapPartNode({
    id,
    width,
    height,
    attention = 'default',
    tone,
    held = false,
    picked,
    openLabel,
    title,
    onOpen,
    source,
    head,
    action,
    name,
    glyph,
    facts,
    slices,
    reference,
    repository,
    activity,
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
    /** Other work holds it, so its step and track are quiet beside the foot that says so. */
    held?: boolean;
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
    /** The card's head line: its kind in words and its fields; its reference follows. */
    head: ReactNode;
    /** What it asks next. */
    action?: ReactNode;
    /** The part's name. */
    name: ReactNode;
    /** The part's status glyph. */
    glyph: ReactNode;
    /** Its facts on one line. */
    facts: string;
    /** Which part it is, its ticket's "#139" or "Part 15", after its kind. */
    reference: string;
    /** Another project's identity, for a decision made in a project other than its lane's, beside its reference. */
    repository?: ReactNode;
    /** Queue and gate facts from the current work record ("Not queued", "Brief not approved"), quiet beside its
     *  reference and in its tooltip. */
    recordState: string;
    /** What its thread is doing now, an ActivityLine, on a quiet line of its own while its thread is at work. */
    activity?: ReactNode;
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
            data-map-card
            data-map-held={held || undefined}
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
                    </span>
                </>
            }
            track={
                track && (
                    <span className="flex items-center" data-map-track>
                        {track}
                    </span>
                )
            }
            name={name}
            sub={
                <>
                    {(reference || repository || recordState) && (
                        <span className="flex min-w-0 items-center gap-1.5" data-map-sub>
                            {reference && (
                                <span className="shrink-0" data-map-reference>
                                    {reference}
                                </span>
                            )}
                            {repository && (
                                <span className="flex min-w-0 shrink items-center gap-1.5">
                                    {reference && <span aria-hidden="true">·</span>}
                                    {repository}
                                </span>
                            )}
                            {recordState && (reference || repository) && <span aria-hidden="true">·</span>}
                            {recordState && (
                                <span className="min-w-0 truncate" title={recordState} data-map-record-state>
                                    {recordState}
                                </span>
                            )}
                        </span>
                    )}
                    {activity && (
                        <span className="flex min-w-0" data-map-activity>
                            {activity}
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
            bottom={
                slices && (
                    <span className="shrink-0" data-map-slices>
                        {slices}
                    </span>
                )
            }
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
            data-map-card
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
export function MapPrerequisiteNode({
    prerequisite,
    width,
    height,
}: {
    prerequisite: WorkMapPrerequisite;
    width: number;
    height: number;
}) {
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
            style={{ width, height }}
            data-map-card
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
