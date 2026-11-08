import type { Status } from '@lar-factory/shared';
// The five-stage track a dossier's parts show, and the note pointing to the desk when an item waits on you.

import { stageOf, STAGES } from './StageStatus';
import { StatusGlyph } from '@/features/items';
import { OnYourDesk as DesignOnYourDesk, stageColor, StageTrack } from '@/ui/board';

/** Where to act on an item that waits on you. */
export function OnYourDesk() {
    return <DesignOnYourDesk>on your desk</DesignOnYourDesk>;
}

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
