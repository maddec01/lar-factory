import { SegmentedProgress } from '@lar-works/design-system';
import type { ReactNode } from 'react';

const PAST = 'var(--color-board-past)';

/**
 * A piece of work's place on the board's active stages: its status glyph, then one joined segment per stage (the
 * design system's segmented track), the past ones filled, the current one half-filled in `color` and outlined while it
 * `waiting`s. Complete work shows `glyph` alone, a tick, in place of the track.
 */
export function StageTrack({
    stages,
    at,
    color,
    glyph,
    title,
    waiting = false,
    complete = false,
}: {
    /** The stages' names, in order. */
    stages: readonly string[];
    /** The current stage's index. */
    at: number;
    /** The current stage's identity colour: `stageColor[status]` (its status's colour, violet for Review). */
    color: string;
    /** The current stage's status glyph. */
    glyph: ReactNode;
    /** The track in full, as its tooltip and its name for screen readers. */
    title: string;
    /** The work waits: the current segment is outlined, not filled. */
    waiting?: boolean;
    /** The work is complete: the glyph alone takes the track's place. */
    complete?: boolean;
}) {
    if (complete)
        return (
            <span className="flex h-5 items-center" title={title}>
                {glyph}
            </span>
        );

    return (
        <span className="flex h-5 min-w-0 items-center gap-2" title={title} data-stage-track>
            {glyph}
            <SegmentedProgress
                label={title}
                layout="joined"
                size="sm"
                current={at}
                segments={stages.map((name, n) =>
                    n < at
                        ? { label: `${name}, done`, color: PAST }
                        : n === at
                          ? { label: `${name}, current`, color, value: 0.5, waiting }
                          : { label: name },
                )}
            />
        </span>
    );
}
