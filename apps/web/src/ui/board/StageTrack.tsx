import type { ReactNode } from 'react';

const PAST = 'var(--color-board-past)';

/**
 * A piece of work's place on the board's active stages: one segment per stage, the past ones filled, and the current
 * one half-filled in `color` under `glyph` (its status glyph), faint and ringed dashed while it `waiting`s. Complete
 * work shows `glyph` alone, a tick, in place of the track.
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
    /** The track in full, as its tooltip. */
    title: string;
    /** The work waits: the current segment is faint and ringed dashed. */
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
        <ol className="m-0 grid list-none grid-cols-5 gap-px p-0" title={title}>
            {stages.map((name, n) => (
                <li key={name} className="relative flex h-5 items-center justify-center">
                    <span
                        className={`absolute inset-x-0 h-1.5 ${n === 0 ? 'rounded-l-full' : ''} ${n === stages.length - 1 ? 'rounded-r-full' : ''}`}
                        style={{ background: n < at ? PAST : 'var(--color-track)' }}
                    />
                    {n === at && (
                        <>
                            <span
                                className={`absolute right-1/2 left-0 h-1.5 ${n === 0 ? 'rounded-l-full' : ''}`}
                                style={{ background: color, opacity: waiting ? 0.35 : 1 }}
                            />
                            <span
                                className={`bg-surface-raised relative grid size-5 place-items-center rounded-full ${waiting ? 'border-fg-muted border border-dashed' : ''}`}
                            >
                                {glyph}
                            </span>
                        </>
                    )}
                </li>
            ))}
        </ol>
    );
}
