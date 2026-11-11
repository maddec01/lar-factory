// A piece of work's activity as the board reads it from T3: the design system's segmented track, swept while it runs.

import { SegmentedProgress } from '@lar-works/design-system';

/** A thin track named by `label`, swept by a bar while `running`; still, it is the bare track. */
export function ActivityTrack({
    label,
    running,
}: {
    /** What the track stands for, for screen readers. */
    label: string;
    /** Work is under way: a bar sweeps the track. */
    running: boolean;
}) {
    return (
        <div className="activity-track min-w-0" data-activity-track={running ? 'running' : 'still'}>
            <SegmentedProgress
                label={label}
                size="sm"
                segments={[running ? { label, state: 'active', sweep: true } : { label }]}
            />
        </div>
    );
}
