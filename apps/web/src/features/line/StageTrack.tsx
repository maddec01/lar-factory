// The board's stages: the five-stage track a dossier's parts show, and what a row says of an item's thread and of an
// item that waits on you.

import { clock, currentBuildThread, delegatedWorkRunning } from '@lar-factory/shared';
import type { Item, ItemStats, ItemThread, Status, ThreadState } from '@lar-factory/shared';
import { OnYourDesk as DesignOnYourDesk, StageTrack } from '@lar-works/design-system';

import { STATUS_COLOR, StatusGlyph } from '@/features/items';

const STAGES: { name: string; statuses: Status[] }[] = [
    { name: 'Refining', statuses: ['Shaping', 'Needs you'] },
    { name: 'Ready', statuses: ['Ready'] },
    { name: 'Building', statuses: ['In progress'] },
    { name: 'Review', statuses: ['Review'] },
    { name: 'Verify', statuses: ['Verify', 'Ready to merge'] },
];

/** Done follows the active stages; List and Queued sit before them. */
export const stageOf = (s: Status) =>
    s === 'Done' ? STAGES.length : STAGES.findIndex((st) => st.statuses.includes(s));

/** The desk's statuses a row takes no action on. */
export const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];

/** Activity comes from T3, never from the item's workflow status. */
const THREAD_TEXT: Record<ThreadState, string> = {
    running: 'Thread running',
    'needs you': 'Thread needs you',
    stopped: 'Run stopped',
    done: 'Run finished',
};

export function threadText(item: Item, working: boolean): string {
    const latest = Array.isArray(item.threads) ? item.threads[0] : undefined;
    // A build's own run can end while its slices or children work on, and a shaping run's children too; say both.
    const parent = (Array.isArray(item.threads) && currentBuildThread(item)) || latest;

    if (parent && !parent.observedAt && (parent.state === 'done' || parent.state === 'stopped')) {
        const ended = `parent ${THREAD_TEXT[parent.state].toLowerCase()}`;

        if (delegatedWorkRunning(item) || parent.hasRunningChildren)
            return working ? `${ended.charAt(0).toUpperCase()}${ended.slice(1)}` : `Working, ${ended}`;

        // A live child that isn't running hasn't finished either, though it isn't Working.
        if (parent.hasLiveChildren) return `${THREAD_TEXT[parent.state]}, child waiting`;
    }

    if (working) return THREAD_TEXT.running;

    if (item.threads === 'unavailable') return 'Thread unavailable';

    return latest ? `${THREAD_TEXT[latest.state]}${lastSeen(latest)}` : 'Not started';
}

/** While T3 can't be read, when the board last saw the thread's state: `, last seen 14:05`; empty otherwise. */
export const lastSeen = (thread: ItemThread): string =>
    thread.observedAt ? `, last seen ${clock(thread.observedAt, undefined)}` : '';

/** Where to act on an item that waits on you. */
export function OnYourDesk() {
    return <DesignOnYourDesk>on your desk</DesignOnYourDesk>;
}

export const statsOf = (item: Item): ItemStats | null =>
    item.stats && item.stats !== 'unavailable' ? item.stats : null;

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
            color={STATUS_COLOR[status]}
            glyph={<StatusGlyph status={status} running={status !== 'Done' && running} />}
            title={status === 'Done' ? 'Complete' : `${label}${waiting ? ', waiting' : ''}`}
            waiting={waiting}
            complete={status === 'Done'}
        />
    );
}
