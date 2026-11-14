// The board's statuses and the colour each is drawn in. A status's colour is its state's (feedback/StatusState's one
// map), so the board never shows a status in a colour the other apps don't; the violet review role is the Review
// stage's identity on a stage bar only, never a status.

import { type StatusState, statusStateColors } from '@lar-works/design-system';

/** A piece of work's status on the board. */
export type BoardStatus =
    | 'List'
    | 'Queued'
    | 'Shaping'
    | 'Needs you'
    | 'Ready'
    | 'In progress'
    | 'Review'
    | 'Verify'
    | 'Ready to merge'
    | 'Done';

/** What each status means, which fixes its colour: not started, or ready and waiting for a build slot, is off (grey);
 *  work being shaped, built or reviewed is active (blue); your turn is waiting (amber); built and mergeable or done is
 *  ready (green). */
export const boardStatusState = {
    List: 'off',
    Queued: 'off',
    Shaping: 'active',
    'Needs you': 'waiting',
    Ready: 'off',
    'In progress': 'active',
    Review: 'active',
    Verify: 'waiting',
    'Ready to merge': 'ready',
    Done: 'ready',
} as const satisfies Record<BoardStatus, StatusState>;

/** Each status's colour, as a CSS colour value: its state's colour, for a status glyph, a dot or a bar segment. */
export const statusColor = Object.fromEntries(
    Object.entries(boardStatusState).map(([status, state]) => [status, statusStateColors[state]]),
) as Record<BoardStatus, string>;

/** Each stage's identity colour on a stage bar (StageTrack's current segment): its status's colour, except Review,
 *  whose stage is violet so the bar tells it from building. Never for a status light, glyph or word. */
export const stageColor: Record<BoardStatus, string> = { ...statusColor, Review: 'var(--color-board-review)' };

/** The board's role colours (board/tokens.css) and the empty track, as CSS colour values, for a glyph, a dot or a bar
 *  segment the board colours by what it means. Each is a state's colour, except `review` (the Review stage's identity,
 *  for a stage bar only). Never for text. */
export const boardColor = {
    you: 'var(--color-board-you)',
    active: 'var(--color-board-active)',
    review: 'var(--color-board-review)',
    done: 'var(--color-board-done)',
    idle: 'var(--color-board-idle)',
    empty: 'var(--color-track)',
} as const;

/** Where a slice stands. `waiting` is a slice not started yet (word it "Queued"); `blocked` one held up by another. */
export type SliceProgress = 'done' | 'active' | 'blocked' | 'unknown' | 'waiting';

/** What each slice progress means, which fixes its colour: blocked by other work and not started are off (grey), as
 *  amber is kept for what waits on you. */
export const sliceProgressState = {
    done: 'ready',
    active: 'active',
    blocked: 'off',
    unknown: 'off',
    waiting: 'off',
} as const satisfies Record<SliceProgress, StatusState>;

/** The word a slice row shows when the caller gives none. */
export const sliceProgressLabel: Record<SliceProgress, string> = {
    done: 'Done',
    active: 'Working',
    blocked: 'Blocked',
    unknown: 'Unknown',
    waiting: 'Queued',
};

/** What each tone means, which fixes its light (the one state map): your turn is waiting (amber), a decision being
 *  made and ready work active (blue), a part blocked by other work, work not started and open questions off (grey).
 *  The label itself is text, in a text token. */
export const attentionToneState = {
    yours: 'waiting',
    decision: 'active',
    blocked: 'off',
    waiting: 'off',
    ready: 'active',
    fog: 'off',
} as const satisfies Record<string, StatusState>;

/** An attention row's tone, which colours the dot before its label. */
export type AttentionTone = keyof typeof attentionToneState;
