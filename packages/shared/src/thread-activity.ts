import type { BoardData, ItemThread } from './model.ts';

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

/** How long a thread at work can go with no new action and no tool running before it reads as quiet. */
const QUIET_MS = 5 * 60_000;

const ageOf = (at: string, now: number): number => Math.max(0, now - Date.parse(at));

/** What a row shows for `thread` at `now`; undefined for a thread that finished with nothing at work. */
export function threadActivityLine(thread: ItemThread, now: number): ThreadActivityLine | undefined {
  const { activity } = thread;
  if (thread.observedAt || activity?.available === false) return { state: 'unavailable', action: 'Activity unavailable', agents: 0 };
  const agents = activity?.agents ?? [];
  if (thread.state === 'needs you') return { state: 'waiting', action: 'Waiting on you', ageMs: ageOf(thread.updated, now), agents: agents.length };
  if (thread.state === 'stopped' && !agents.length) return { state: 'stopped', action: 'Stopped', ageMs: ageOf(thread.updated, now), agents: 0 };
  if (!activity) return thread.state === 'running' || thread.queued || thread.hasLiveChildren || thread.hasRunningChildren
    ? { state: 'unavailable', action: 'Activity unavailable', agents: 0 } : undefined;
  if (thread.queued && !agents.length) return { state: 'working', action: 'Queued', ageMs: ageOf(thread.updated, now), agents: 0 };
  const newest = [{ action: activity.action, actionAt: activity.actionAt ?? thread.updated }, ...agents.flatMap(({ action, actionAt }) => (actionAt ? [{ action, actionAt }] : []))]
    .reduce((best, next) => (Date.parse(next.actionAt) > Date.parse(best.actionAt) ? next : best));
  const ageMs = ageOf(newest.actionAt, now);
  if (ageMs >= QUIET_MS && !activity.toolRunning) return { state: 'quiet', action: `No action for ${Math.floor(ageMs / 60_000)}m`, ageMs, agents: agents.length };
  // A thread that has just started may be newer than an agent's last action, and has no words of its own.
  const action = newest.action ?? activity.action ?? agents.find((agent) => agent.action)?.action ?? 'Starting';
  return { state: 'working', action, ageMs, agents: agents.length };
}

/** The moment the sample's times count from, so its ages read the same whenever the sample board runs. */
const SAMPLE_NOW = Date.parse('2026-10-21T10:00:00Z');

/** The sample board with its activity times moved so its ages count from `now`. */
export function sampleActivityFrom(data: BoardData, now: number): BoardData {
  const moved = (at: string) => new Date(Date.parse(at) + now - SAMPLE_NOW).toISOString();
  return {
    ...data,
    items: data.items.map((item) => (!Array.isArray(item.threads) ? item : {
      ...item,
      threads: item.threads.map((thread) => {
        const { activity } = thread;
        if (!activity?.available) return thread;
        return {
          ...thread,
          updated: moved(thread.updated),
          activity: {
            ...activity,
            ...(activity.actionAt ? { actionAt: moved(activity.actionAt) } : {}),
            agents: activity.agents.map((agent) => ({ ...agent, ...(agent.actionAt ? { actionAt: moved(agent.actionAt) } : {}) })),
          },
        };
      }),
    })),
  };
}
