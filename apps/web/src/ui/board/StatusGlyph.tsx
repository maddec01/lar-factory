// One glyph per status of Lar Factory's work, the way T3 marks a thread working, waiting or done: the design system's
// StatusIndicator with the status's glyph, in its state's colour (StatusColors' boardStatusState, through the one state
// map), turning or breathing on the design system's motion while the work runs.

import { StatusIndicator, type StatusState } from '@lar-works/design-system';
import {
    CheckIcon,
    CircleArrowRightIcon,
    CircleDashedIcon,
    CircleDotIcon,
    CircleIcon,
    Clock3Icon,
    EyeIcon,
    GitMergeIcon,
    ListIcon,
} from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { conceptIcons } from './ConceptIcons';
import { type BoardStatus, boardStatusState } from './StatusColors';

const { stopped: StoppedIcon } = conceptIcons;

/** A slot's fixed box: `sm` 14px (the StatusIndicator's `sm` glyph box), `md` and `lg` 16px (its `md` box). */
const sizes = { sm: 'size-3.5', md: 'size-4', lg: 'size-4' } as const;

/** The statuses whose glyph breathes while their work runs; In progress turns instead. */
const pulses: BoardStatus[] = ['Shaping', 'Review', 'Verify', 'Ready to merge'];

/**
 * The fixed box every status mark in a row's leading slot sits in, so the title column never shifts between a ring
 * glyph and a status light: StatusGlyph draws itself in one, and a StatusIndicator (an item's PR readiness, say) that
 * stands in for a glyph goes in one too. In a row's leading icons the status comes first, then the source icon.
 */
export function StatusGlyphSlot({
    size = 'md',
    children,
}: {
    /** The slot's size, as the glyph's beside it: `sm` 14px beside small text, `md` 16px (the default) and `lg`. */
    size?: keyof typeof sizes;
    /** The mark: a StatusGlyph's icon or a StatusIndicator. */
    children: ReactNode;
}) {
    return (
        <span
            data-slot="status-glyph"
            className={`inline-flex shrink-0 items-center justify-center overflow-visible ${sizes[size]}`}
        >
            {children}
        </span>
    );
}

/** Whether `state` says the work stopped: `off` on a status whose own state is not off. */
const stopped = (status: BoardStatus, state: StatusState | undefined) =>
    state === 'off' && boardStatusState[status] !== 'off';

/** Each status's glyph, drawn at the StatusIndicator's stroke. */
const glyphs: Record<BoardStatus, ReactNode> = {
    List: <ListIcon strokeWidth={2.25} />,
    Queued: <Clock3Icon strokeWidth={2.25} />,
    Shaping: <CircleDashedIcon strokeWidth={2.25} />,
    'Needs you': null,
    Ready: <CircleArrowRightIcon strokeWidth={2.25} />,
    'In progress': <CircleIcon strokeWidth={2.25} />,
    Review: <EyeIcon strokeWidth={2.25} />,
    Verify: <CircleDotIcon strokeWidth={2.25} />,
    'Ready to merge': <GitMergeIcon strokeWidth={2.25} />,
    Done: <CheckIcon strokeWidth={2.25} />,
};

/**
 * A status's glyph in its colour, in its fixed box (StatusGlyphSlot): the design system's StatusIndicator with the
 * status's `glyph`. `running` sets it to work while its work is known to run: In progress turns (the spinner), and
 * Shaping, Review, Verify and Ready to merge breathe. `size` sizes it: `sm` beside small text, `md` (the default) and
 * `lg`. Its colour is its status's state (boardStatusState), or `state` when the work's state differs from its stage's:
 * `waiting` (amber) for blocked work, and `off` for stopped work, which also takes the Stopped glyph
 * (conceptIcons.stopped), so stopped work never wears its stage's glyph, such as Review's eye. Needs you is the
 * waiting light itself.
 */
export function StatusGlyph({
    status,
    state,
    running = false,
    size = 'md',
}: {
    /** The board status the glyph stands for. */
    status: BoardStatus;
    /** The work's state when it isn't its status's: `waiting` for blocked work, `off` for stopped work (the Stopped
     *  glyph); it colours the glyph. */
    state?: StatusState | undefined;
    /** Its work is known to run: the glyph turns or breathes. */
    running?: boolean;
    /** The glyph's size by where it sits: `sm`, `md` (the default) or `lg`. */
    size?: keyof typeof sizes;
}) {
    const shownState = state ?? boardStatusState[status];
    const halt = stopped(status, state);
    const motion =
        halt || !running
            ? undefined
            : status === 'In progress'
              ? 'spin'
              : pulses.includes(status)
                ? 'pulse'
                : undefined;
    const mark =
        status === 'Needs you' && !halt ? (
            <StatusIndicator state={shownState} />
        ) : (
            <StatusIndicator
                state={shownState}
                size={size === 'sm' ? 'sm' : 'md'}
                // A running build's mark is the design system's spinner.
                glyph={halt ? <StoppedIcon strokeWidth={2.25} /> : motion === 'spin' ? undefined : glyphs[status]}
                motion={motion}
            />
        );

    return <StatusGlyphSlot size={size}>{mark}</StatusGlyphSlot>;
}
