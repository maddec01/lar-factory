import type { Status } from '@lar-factory/shared';
// The five-stage track a dossier's parts show.

import { stageOf, STAGES } from './StageStatus';
import { StatusGlyph } from '@/features/items';
import { stageColor, StageTrack } from '@/ui/board';

/** Active stages only; completed parts keep a check instead of a further workflow step. */
export function Track({
    status,
    label = status,
    waiting,
    running = false,
}: {
    status: Status;
    label?: string;
    waiting?: boolean;
    running?: boolean;
}) {
    const at = stageOf(status);

    if (status !== 'Done' && at < 0) return null;

    return (
        <StageTrack
            stages={STAGES.map((st) => st.name)}
            at={at}
            color={stageColor[status]}
            glyph={<StatusGlyph status={status} running={status !== 'Done' && running} />}
            title={status === 'Done' ? 'Complete' : `${label}${waiting ? ', waiting' : ''}`}
            waiting={waiting}
            complete={status === 'Done'}
        />
    );
}
