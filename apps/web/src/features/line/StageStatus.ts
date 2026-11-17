// The active stages and their statuses, with the words a row uses for its thread and last read.

import { clock, currentBuildThread, delegatedWorkRunning } from '@lar-factory/shared';
import type { Item, ItemStats, ItemThread, Status, ThreadActivityState, ThreadState } from '@lar-factory/shared';

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

export const statsOf = (item: Item): ItemStats | null =>
    item.stats && item.stats !== 'unavailable' ? item.stats : null;

/** The mark a row's state cell leads with when it says a state in words, not its thread's activity: the thread's own
 *  mark while it waits, is quiet, stopped or unread, else none, which keeps the mark's room. */
export const stateMark = (activity: ThreadActivityState | undefined) =>
    activity && activity !== 'working' ? activity : ('none' as const);

/** Whether `item`'s review round still runs: a chosen reviewer waits to start or is at work. While it does, its
 *  reviewers take the row's progress column. */
export const reviewing = (item: Item): boolean =>
    !!item.reviewers?.some((r) => r.status === 'Waiting' || r.status === 'Running');

/** How many of the round's reviewers have finished, "1/2 reviews", as a row's count and a map card's foot say it. */
export function reviewCount(item: Item): string {
    const reviewers = item.reviewers ?? [];
    const finished = reviewers.filter((r) => r.status !== 'Waiting' && r.status !== 'Running').length;

    return `${finished}/${reviewers.length} reviews`;
}

/** A build fixing a failed Verify: Verify's note, which the row's state cell keeps in its tooltip. */
export const failedVerifyNote = (item: Item): string | undefined =>
    item.status === 'In progress' && item.verification?.latest?.result === 'fail'
        ? `Failed Verify: ${item.verification.latest.note}`
        : undefined;
