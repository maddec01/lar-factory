// One glyph per status of Lar Factory's work, the way T3 marks a thread working, waiting or done, in the status's
// state's colour (StatusColors' boardStatusState, through the one state map).

import { ambientMotion, StatusIndicator, type StatusState, statusStateColors } from '@lar-works/design-system';
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
import { SpinnerIcon } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import { conceptIcons } from './ConceptIcons';
import { type BoardStatus, boardStatusState, statusColor } from './StatusColors';

const { stopped: StoppedIcon } = conceptIcons;

/** A glyph's size, and its slot's fixed box: `sm` 12px, `md` 14px or `lg` 16px square. */
const sizes = { sm: 'size-3', md: 'size-3.5', lg: 'size-4' } as const;

/** The statuses whose glyph pulses while their work runs; In progress spins instead. */
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
    /** The slot's size, as the glyph's beside it: `sm` 12px beside small text, `md` 14px (the default), `lg` 16px
     *  beside a title. */
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

/**
 * A status's glyph in its colour, in its fixed box (StatusGlyphSlot). `running` animates it while its work is known to
 * run: In progress spins, and Shaping, Review, Verify and Ready to merge pulse. `size` sizes it: `sm` 12px beside
 * small text, `md` 14px (the default), `lg` 16px beside a title. Its colour is its status's state (boardStatusState), or `state`
 * when the work's state differs from its stage's: `waiting` (amber) for blocked work, and `off` for stopped work,
 * which also takes the Stopped glyph (conceptIcons.stopped), so stopped work never wears its stage's glyph, such as
 * Review's eye.
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
    /** Its work is known to run: the glyph spins or pulses. */
    running?: boolean;
    /** The glyph's size by where it sits: `sm`, `md` (the default) or `lg`. */
    size?: keyof typeof sizes;
}) {
    return (
        <StatusGlyphSlot size={size}>
            <GlyphIcon status={status} state={state} running={running} size={size} />
        </StatusGlyphSlot>
    );
}

/** Whether `state` says the work stopped: `off` on a status whose own state is not off. */
const stopped = (status: BoardStatus, state: StatusState | undefined) =>
    state === 'off' && boardStatusState[status] !== 'off';

function GlyphIcon({
    status,
    state,
    running,
    size,
}: {
    status: BoardStatus;
    state?: StatusState | undefined;
    running: boolean;
    size: keyof typeof sizes;
}) {
    const pulse = running && pulses.includes(status);
    const props = {
        ref: pulse ? ambientMotion : undefined,
        className: `shrink-0 ${sizes[size]}${pulse ? ' status-pulse' : ''}`,
        style: { color: state ? statusStateColors[state] : statusColor[status] },
        strokeWidth: 2.25,
    };

    if (stopped(status, state)) return <StoppedIcon {...props} />;

    switch (status) {
        case 'List':
            return <ListIcon {...props} />;
        case 'Needs you':
            return <StatusIndicator state={state ?? 'waiting'} />;
        case 'Verify':
            return <CircleDotIcon {...props} />;
        case 'In progress':
            return running ? <SpinnerIcon motion="status" {...props} /> : <CircleIcon {...props} />;
        case 'Ready':
            return <CircleArrowRightIcon {...props} />;
        case 'Shaping':
            return <CircleDashedIcon {...props} />;
        case 'Review':
            return <EyeIcon {...props} />;
        case 'Ready to merge':
            return <GitMergeIcon {...props} />;
        case 'Done':
            return <CheckIcon {...props} />;
        case 'Queued':
            return <Clock3Icon {...props} />;
        default:
            return <CircleIcon {...props} />;
    }
}
