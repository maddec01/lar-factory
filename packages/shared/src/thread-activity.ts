import { isLiveThread, type BoardData, type Item, type ItemThread } from './model.ts';
import { rebaseSampleTimes } from './sample-clock.ts';

/** A native subagent or child task working for a thread. */
export interface ThreadAgent {
    title: string;
    model?: string;
    /** The agent's newest action; absent until it takes one. */
    action?: string;
    /** When it took that action, or started; absent when T3 records neither. */
    actionAt?: string;
}

/** What a thread and its agents are doing now. `available: false` when T3 can't be read, so no old action reads as current. */
export type ThreadActivity =
    | { available: false }
    | {
          available: true;
          /** When the board read this from T3. An old one means T3's answer stopped coming, whatever else the board could read. */
          readAt: string;
          /** The thread's newest action; absent until it takes one. */
          action?: string;
          actionAt?: string;
          /** A command or other tool still runs for the thread or an agent. Waiting on an agent doesn't count. */
          toolRunning: boolean;
          agents: ThreadAgent[];
      };

export type ThreadActivityState = 'working' | 'quiet' | 'waiting' | 'stopped' | 'unavailable';

/** What a row shows of a thread's activity. */
export interface ThreadActivityLine {
    state: ThreadActivityState;
    action: string;
    /** How long ago the action happened. */
    ageMs?: number;
    agents: number;
}

/** What a row's state column says instead of its phase, while one of these holds. */
export const ACTIVITY_WORD: Partial<Record<ThreadActivityState, string>> = {
    quiet: 'Quiet',
    waiting: 'Needs you',
    stopped: 'Stopped',
};

/** How long a thread at work can go with no new action and no tool running before it reads as quiet. */
const QUIET_MS = 5 * 60_000;

/**
 * How old an activity read can be before it reads as unavailable. The board reads T3 every 2 seconds and sends pages a
 * read at least every 10, so this leaves about 18 seconds for a slow pass before a row changes.
 */
export const ACTIVITY_STALE_MS = 30_000;

/** Whether T3's answer for a thread is lost: its read failed or has gone old. */
export function activityLost(activity: ThreadActivity | undefined, now: number): boolean {
    if (!activity) return false;

    return !activity.available || now - Date.parse(activity.readAt) > ACTIVITY_STALE_MS;
}

const UNAVAILABLE: ThreadActivityLine = { state: 'unavailable', action: 'Activity unavailable', agents: 0 };

const activityAction = (action: string | undefined) =>
    action?.replace(/(?:[\w.-]+__)*AskUserQuestion/g, 'Waiting for your answer');

const ageOf = (at: string, now: number): number => Math.max(0, now - Date.parse(at));

/** What a row shows for `thread` at `now`; undefined for a thread that finished with nothing at work. */
export function threadActivityLine(thread: ItemThread, now: number): ThreadActivityLine | undefined {
    const { activity } = thread;

    if (thread.observedAt || activity?.available === false || activityLost(activity, now)) return UNAVAILABLE;

    const agents = activity?.agents ?? [];

    if (thread.state === 'needs you' || thread.childNeedsYou)
        return { state: 'waiting', action: 'Needs you', ageMs: ageOf(thread.updated, now), agents: agents.length };

    if (thread.state === 'stopped' && !agents.length)
        return { state: 'stopped', action: 'Stopped', ageMs: ageOf(thread.updated, now), agents: 0 };

    if (!activity)
        return thread.state === 'running' || thread.queued || thread.hasLiveChildren || thread.hasRunningChildren
            ? UNAVAILABLE
            : undefined;

    if (thread.queued && !agents.length)
        return { state: 'working', action: 'Queued', ageMs: ageOf(thread.updated, now), agents: 0 };

    const newest = [
        { action: activity.action, actionAt: activity.actionAt ?? thread.updated },
        ...agents.flatMap(({ action, actionAt }) => (actionAt ? [{ action, actionAt }] : [])),
    ].reduce((best, next) => (Date.parse(next.actionAt) > Date.parse(best.actionAt) ? next : best));
    const ageMs = ageOf(newest.actionAt, now);

    if (ageMs >= QUIET_MS && !activity.toolRunning)
        return { state: 'quiet', action: `No action for ${Math.floor(ageMs / 60_000)}m`, ageMs, agents: agents.length };

    // A thread that has just started may be newer than an agent's last action, and has no words of its own.
    const action = newest.action ?? activity.action ?? agents.find((agent) => agent.action)?.action ?? 'Starting';

    return { state: 'working', action: activityAction(action)!, ageMs, agents: agents.length };
}

/** Statuses whose work may be under way, so a stopped thread or a T3 that can't be read matters to the row. */
const UNDER_WAY: readonly Item['status'][] = ['Shaping', 'In progress', 'Review'];

/** The thread a row follows: the newest at work, else the newest if it stopped work still under way. Threads come newest first. */
export function itemActivityThread(item: Item): ItemThread | undefined {
    if (item.paused || item.archived || !Array.isArray(item.threads)) return undefined;

    const threads = item.threads.filter((thread) => !thread.archived);
    const atWork = threads.find((thread) => isLiveThread(thread) || thread.hasRunningChildren);

    return atWork ?? (threads[0]?.state === 'stopped' && UNDER_WAY.includes(item.status) ? threads[0] : undefined);
}

/** What `item`'s row shows at `now`; undefined when it shows no line. `unreadable` is a page that lost the server, whose threads may be out of date. */
export function itemActivityLine(item: Item, now: number, unreadable = false): ThreadActivityLine | undefined {
    if (item.paused || item.archived) return undefined;

    if (item.threads === 'unavailable') return UNDER_WAY.includes(item.status) ? UNAVAILABLE : undefined;

    const thread = itemActivityThread(item);

    if (!thread) return undefined;

    return unreadable ? UNAVAILABLE : threadActivityLine(thread, now);
}

/** Who `item`'s thread has at work: its own action first, as the lead thread, then its agents. Undefined with nothing to list, and 'unavailable' when the line says so, so no old action reads as current. */
export function itemActivityAgents(
    item: Item,
    now: number,
    unreadable = false,
): ThreadAgent[] | 'unavailable' | undefined {
    const state = itemActivityLine(item, now, unreadable)?.state;

    if (state === 'unavailable') return 'unavailable';

    const activity = itemActivityThread(item)?.activity;

    if (!state || state === 'stopped' || !activity?.available) return undefined;

    const { action, actionAt, agents } = activity;
    const listed = [
        ...(action ? [{ title: 'Lead thread', action, ...(actionAt ? { actionAt } : {}) }] : []),
        ...agents,
    ];

    return listed.length
        ? listed.map((agent) => (agent.action ? { ...agent, action: activityAction(agent.action)! } : agent))
        : undefined;
}

/** Whether `item`'s row stops animating at `now`: its thread waits, stopped or can't be read. */
export function itemActivityStill(item: Item, now: number, unreadable = false): boolean {
    const state = itemActivityLine(item, now, unreadable)?.state;

    return state === 'waiting' || state === 'stopped' || state === 'unavailable';
}

/** The whole sample board moves together from its authored read time to this load. */
export function sampleActivityFrom(data: BoardData, now: number): BoardData {
    const anchor = Date.parse(data.fetchedAt ?? '');

    return {
        ...rebaseSampleTimes(data, Number.isFinite(anchor) ? now - anchor : 0),
        fetchedAt: new Date(now).toISOString(),
    };
}
