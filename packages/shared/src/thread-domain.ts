// Project settings and onboarding contracts.

import { type BoardData, type ModelSelection } from './board-domain.ts';
import { type Item } from './item-domain.ts';
import type { RoleRunFinish } from './run-settings.ts';
import type { ThreadActivity } from './thread-activity.ts';

/** Frozen before a launch is sent, so an interrupted launch replays the same T3 command. */
export interface ThreadLaunchRequest {
    projectId: string;
    text: string;
    selection: ModelSelection;
    workspace:
        | { type: 'root' }
        | { type: 'worktree'; baseRef: string; branch: string }
        | { type: 'existing_worktree'; worktreePath: string; branch: string };
    runtimeMode: string;
}

/** What the board offers for work that needs you. */
export const NEEDS_YOU_OFFERS = [
    'reopen-pr',
    'replace-pr',
    'keep-working',
    'mark-handled',
    'set-aside',
    'start-again',
    'back-to-queue',
    'back-to-list',
] as const;

export type NeedsYouOffer = (typeof NEEDS_YOU_OFFERS)[number];

/** A change the board saw that makes work wait on the user. `assignee-changed` holds who its ticket moved from and to, null for no one. */
export type NeedsYouCause =
    | { type: 'pr-closed' }
    | { type: 'ticket-closed' }
    | { type: 'assignee-changed'; from: string | null; to: string | null }
    | { type: 'ticket-missing' }
    | { type: 'no-thread' };

/** `running` during a turn, `needs you` at a request, `stopped` after an interrupted or failed turn, else `done`. */
export type ThreadState = 'running' | 'needs you' | 'stopped' | 'done';

/** A T3 Code thread whose first user message names the item before any other issue. */
export interface ItemThread {
    id: string;
    title: string;
    state: ThreadState;
    /** The thread's latest message, turn or runtime request time. */
    updated: string;
    /** The pending request's question, when T3 supplies a summary. */
    questionSummary?: string;
    /** Set while T3 can't be read: when the board last saw this state. */
    observedAt?: string;
    /** A running, waiting or queued descendant still belongs to this thread's work. */
    hasLiveChildren?: true;
    currentRunning?: true;
    /** T3 has queued this thread's next turn. Its state stays `done`. */
    queued?: true;
    /** T3 archived this thread. T3 opens New thread for an archived thread's link, so the board never links it. */
    archived?: true;
    /** A descendant is running, or this thread or a descendant has background tasks pending, so its work goes on after its turn ended. */
    hasRunningChildren?: true;
    /** A descendant waits on the user. */
    childNeedsYou?: true;
    /** What the thread and its agents are doing now, read for a thread at work. */
    activity?: ThreadActivity;
    /** The work record's thread role, when recorded by the factory. */
    purpose?: string;
}

/** Whether the thread or a descendant is at work, waits on the user or has a queued turn. */
export const isLiveThread = (thread: ItemThread): boolean =>
    thread.state === 'running' || thread.state === 'needs you' || !!thread.queued || !!thread.hasLiveChildren;

/** Resume only an interrupted shaping session whose current thread family is known to have stopped. */
export function canResumeShaping(item: Item): boolean {
    if (item.status !== 'Shaping' || item.needsYou || !Array.isArray(item.threads) || !item.threads.length)
        return false;

    if (
        item.threads.some(
            (thread) =>
                thread.observedAt ||
                thread.hasLiveChildren ||
                thread.state === 'running' ||
                thread.state === 'needs you',
        )
    )
        return false;

    const shaping = item.threads.filter((thread) => thread.purpose === 'shape');

    return (shaping.length ? shaping : item.threads)[0]?.state === 'stopped';
}

/** Whether work a build delegated still runs, a slice's thread or a running child of its build thread, even after that thread's own run ended. */
export function delegatedWorkRunning(item: Item): boolean {
    return (
        !!item.slices?.some((slice) => slice.progress === 'active') || !!currentBuildThread(item)?.hasRunningChildren
    );
}

/** Retry only a build moved to In progress whose current thread stopped before it recorded a build phase. */
export function canRetryBuild(item: Item): boolean {
    if (
        item.status !== 'In progress' ||
        item.buildPhase ||
        item.needsYou ||
        delegatedWorkRunning(item) ||
        !Array.isArray(item.threads)
    )
        return false;

    if (
        item.threads.some(
            (thread) =>
                thread.observedAt ||
                thread.hasLiveChildren ||
                thread.state === 'running' ||
                thread.state === 'needs you',
        )
    )
        return false;

    return item.threads.find((thread) => thread.purpose === 'build')?.state === 'stopped';
}

/** The deep link that opens a T3 thread in T3 Code, as T3's promptLinks.ts parses it (pingdotgg/t3code d53873b6). */
export function threadLink(environmentId: string, threadId: string): string {
    return `t3code://threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

/** A T3 Code thread the board started. */
export interface StartedThread {
    threadId: string;
    title: string;
}

/** What a start's thread will do. */
export type StartPurpose = 'shape' | 'build';

/**
 * A start the server is running, one that left an unresolved launch intent and may have opened a thread, or one that
 * was refused or failed. A start with a thread has none.
 */
export type StartProgress = { phase: 'starting' } | { phase: 'may-have-started' | 'failed'; message: string };

/** The item's start for `purpose` as the server sees it. */
export const startProgressOf = (
    data: Pick<BoardData, 'startProgress'>,
    itemId: string,
    purpose: StartPurpose,
): StartProgress | undefined => data.startProgress?.[itemId]?.[purpose];

/** What starting a thread answered: the thread, or why it did not start. */
export interface StartResult {
    /** Selection reported by T3, never reconstructed from the request. */
    executionReport?: RoleRunFinish['report'];
    thread: StartedThread | null;
    error: string | null;
    /** The thread may have started; starting again could make a second one. */
    uncertain?: boolean;
    /** The skills with Drift, when Start build waits for the User to replace them or start anyway. */
    drift?: string[];
    /** The refusal passes by itself, as T3 or a read comes back, so Auto-build holds instead of pausing the build. */
    hold?: true;
}

export function openQuestionThread(item: Item) {
    return Array.isArray(item.threads)
        ? item.threads.find((thread) => thread.state === 'needs you' && !thread.observedAt)
        : undefined;
}

/** The item's build thread as T3 shows it now, not a cached copy. */
export function currentBuildThread(item: Item) {
    return Array.isArray(item.threads)
        ? item.threads.find((thread) => thread.purpose === 'build' && !thread.observedAt)
        : undefined;
}

/**
 * Whether an item at Verify or Ready to merge is at work again: its current build thread, a child of it or a slice runs, and
 * nothing holds it for the user. It then counts as in flight, with its recorded Status unchanged.
 */
export function workingAgain(item: Item, unavailable = false): boolean {
    if (item.status !== 'Verify' && item.status !== 'Ready to merge') return false;

    if (unavailable || item.paused || item.archived || item.needsYou || openQuestionThread(item)) return false;

    const current = currentBuildThread(item);

    return !!current?.currentRunning || delegatedWorkRunning(item);
}

/**
 * The builds that count against the build limit, in every repository: a build whose start is in flight or may have
 * started, one In progress or Review, and one at Verify or Ready to merge at work again. A concept never counts.
 */
export function buildsAtWork(data: Pick<BoardData, 'items' | 'startProgress'>, unavailable = false): Item[] {
    return data.items.filter((item) => {
        if (item.kind === 'concept') return false;

        const start = startProgressOf(data, item.id, 'build');

        return (
            start?.phase === 'starting' ||
            start?.phase === 'may-have-started' ||
            item.status === 'In progress' ||
            item.status === 'Review' ||
            workingAgain(item, unavailable)
        );
    });
}
