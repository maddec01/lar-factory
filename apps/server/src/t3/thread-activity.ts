// Thread activity: what a thread and its agents are doing now, from T3's turn items and subagent records.

import {
    ACTIVITY_RETAIN_MS,
    isLiveThread,
    type Item,
    type ItemThread,
    type ThreadActivity,
    type ThreadAgent,
} from '@lar-factory/shared';
import type { DatabaseSync } from 'node:sqlite';

import { activityItems, unfinishedAgents, type ActivityAgentRow, type ActivityItemRow } from './t3-db.ts';

/** A thread's place among the shells, as thread activity reads it. */
export interface ActivityFamily {
    /** The thread and the threads below it whose subagent records could name a working agent. */
    threads: Set<string>;
    /** The threads with background tasks pending, which carry on after their run ended. */
    background: Set<string>;
    /** A background command runs for the thread or a thread below it. */
    commandRunning: boolean;
}

const UNFINISHED = new Set(['pending', 'running', 'waiting']);
/** Tools that block on a child thread. Waiting on an agent isn't a tool at work. */
const WAITS_ON_AGENT = /(^|[._])(delegate_task|t3_thread_wait)$/;

const lastSegment = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path;

const ASSIGNMENT = /^[A-Za-z_]\w*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s;&'"])*/;
const SEPARATOR = /^\s*(?:;|&&|\n)\s*/;

/** A stable category after removing the shell wrapper and leading environment setup. */
function commandAction(input: string): string {
    const wrapped = /^\S*\b(?:ba|z|da)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(input.trim());
    const command = wrapped ? (wrapped[1] === '"' ? wrapped[2]!.replace(/\\(["\\$`])/g, '$1') : wrapped[2]!) : input;
    let rest = command.trimStart();

    for (;;) {
        const exporting = /^export\s+/.exec(rest);

        if (exporting) {
            rest = rest.slice(exporting[0].length);
            // An `export` runs to the end of its statement, naming variables with or without values.
            for (
                let name = ASSIGNMENT.exec(rest) ?? /^[A-Za-z_]\w*/.exec(rest);
                name;
                name = ASSIGNMENT.exec(rest) ?? /^[A-Za-z_]\w*/.exec(rest)
            )
                rest = rest.slice(name[0].length).replace(/^[ \t]+/, '');
        } else {
            const assignment = ASSIGNMENT.exec(rest);

            if (!assignment) break;

            rest = rest.slice(assignment[0].length).replace(/^[ \t]+/, '');
        }

        rest = rest.replace(SEPARATOR, '');
    }

    const line = (rest || command).trim().split('\n')[0]!;

    if (/^(?:rg|grep|find)\b/.test(line)) return 'Searching files';

    if (/^(?:cat|sed|head|tail|ls)\b/.test(line)) return 'Reading files';

    if (/^git\s+(?:status|diff|log|show)\b/.test(line)) return 'Checking changes';

    if (/^git\s+push\b/.test(line)) return 'Pushing changes';

    if (/^git\s+commit\b/.test(line)) return 'Committing changes';

    if (/^gh\s+pr\s+create\b/.test(line)) return 'Opening PR';

    if (
        /^(?:pnpm|npm|yarn|bun|npx|nx|pytest|vitest|jest|playwright|cypress|tsc|eslint|shellcheck|knip|xcodebuild|\.\/gradlew)\b/.test(
            line,
        )
    ) {
        if (/\b(?:test(?::[\w-]+)?|pytest|vitest|jest|playwright|cypress)\b/.test(line)) return 'Running tests';

        if (/\b(?:typecheck|tsc)\b/.test(line)) return 'Checking types';

        if (/\b(?:lint|eslint|shellcheck|knip|check)\b/.test(line)) return 'Checking code';

        if (/\b(?:build|assemble|bundle)\b/.test(line)) return 'Building';
    }

    return 'Running a command';
}

/** A tool's title with any path shortened to its file name, or its name without the server it came from. */
function toolAction({ title, toolName }: ActivityItemRow): string | undefined {
    if (/AskUserQuestion/.test(toolName ?? title ?? '')) return 'Waiting for your answer';

    if (title) {
        const path = /^(\w+) ((?:[~/]|\S+\/).*)$/.exec(title);

        const words = path ? `${path[1]} ${lastSegment(path[2]!)}` : title;

        return words.replace(
            /^(Read|Edit|Write|Search)\b/,
            (verb) => ({ Read: 'Reading', Edit: 'Editing', Write: 'Writing', Search: 'Searching' })[verb]!,
        );
    }

    return toolName ? 'Using a tool' : undefined;
}

/** The words for an item; undefined for text that has finished, which is no action. */
function actionOf(item: ActivityItemRow): string | undefined {
    switch (item.type) {
        case 'command_execution':
            return item.input ? commandAction(item.input) : 'Running a command';
        case 'dynamic_tool':
            return toolAction(item);
        case 'file_change':
            return item.fileName ? `Editing ${lastSegment(item.fileName)}` : 'Editing files';
        case 'web_search':
            return 'Searching the web';
        case 'reasoning':
            return item.streaming ? 'Thinking' : undefined;
        case 'assistant_message':
            return item.streaming ? 'Writing' : undefined;
        default:
            return undefined;
    }
}

const timeOf = (item: ActivityItemRow): string | undefined =>
    item.completedAt ?? item.updatedAt ?? item.startedAt ?? undefined;

const isTool = (item: ActivityItemRow): boolean => item.type !== 'reasoning' && item.type !== 'assistant_message';

/** Whether a thread or agent's item reads as still under way. Some read running after their run ended, so the run decides. */
const underWay = (item: ActivityItemRow): boolean =>
    item.runLive !== 0 && (isTool(item) ? UNFINISHED.has(item.status) : !!item.streaming);

/**
 * Only live runs name an action, so a new run with no items cannot show its previous run's tool.
 * Native subagent items have no run and use their agent's liveness. Finished text moves the time on.
 */
function actionFrom(items: ActivityItemRow[]): {
    action?: string;
    actionDetail?: string;
    actionAt?: string;
    toolRunning: boolean;
} {
    const shown = items.filter((item) => item.runLive !== 0);
    const newestFirst = shown.filter((item) => timeOf(item)).sort((a, b) => timeOf(b)!.localeCompare(timeOf(a)!));
    const latest = newestFirst.find((item) => actionOf(underWay(item) ? item : { ...item, streaming: 0 }));
    const action = latest && actionOf(underWay(latest) ? latest : { ...latest, streaming: 0 });
    const actionDetail = latest?.input ?? latest?.title ?? latest?.fileName ?? latest?.toolName;

    return {
        ...(action ? { action, ...(actionDetail && actionDetail !== action ? { actionDetail } : {}) } : {}),
        ...(newestFirst[0] ? { actionAt: timeOf(newestFirst[0]) } : {}),
        toolRunning: shown.some((item) => isTool(item) && underWay(item) && !WAITS_ON_AGENT.test(item.toolName ?? '')),
    };
}

/** Whether an unfinished subagent record is an agent at work. A child with runs of its own goes by them, since a child task outlives the run that started it. A native subagent goes by that run, or its thread's background tasks. */
function agentWorking(row: ActivityAgentRow, parentHasBackground: boolean): boolean {
    return row.childRunLive !== null ? !!row.childRunLive : row.runLive !== 0 || parentHasBackground;
}

/** An agent's name: "Subagent" with no title, and the last segment of a path-like title. */
const agentTitle = (title: string | null): string =>
    !title?.trim() ? 'Subagent' : title.includes('/') && !/\s/.test(title) ? lastSegment(title) : title;

interface ActivityRows {
    items: ActivityItemRow[];
    /** Whether the thread's own run is at work. */
    runLive: boolean;
    agents: { row: ActivityAgentRow; items: ActivityItemRow[] }[];
    commandRunning: boolean;
    /** When these rows were read. */
    readAt: string;
}

/** The activity these rows say. */
function threadActivity({ items, runLive, agents, commandRunning, readAt }: ActivityRows): ThreadActivity {
    const { toolRunning, ...own } = actionFrom(runLive ? items : []);
    let anyTool = toolRunning || commandRunning;
    const working = agents.map(({ row, items: agentItems }): ThreadAgent => {
        const { toolRunning: agentTool, action, actionDetail, actionAt } = actionFrom(agentItems);

        anyTool ||= agentTool;

        return {
            title: agentTitle(row.title),
            ...(row.model ? { model: row.model } : {}),
            ...(action ? { action, ...(actionDetail && actionDetail !== action ? { actionDetail } : {}) } : {}),
            ...((actionAt ?? row.startedAt) ? { actionAt: (actionAt ?? row.startedAt)! } : {}),
        };
    });

    // Answering a request or finishing a child can start another run without going through the board's Start
    // command. Earlier turn items still establish that this owner is continuing, even before its next action.
    return {
        available: true,
        readAt,
        ...(runLive && items.length && !own.action ? { action: 'Resuming' } : {}),
        ...own,
        toolRunning: anyTool,
        agents: working,
    };
}

const UNAVAILABLE: ThreadActivity = { available: false };

/** `items` without their activity reads' times, which move on every pass, so comparing them finds what a row would show differently. */
export function withoutReadTimes(items: Item[]): Item[] {
    return items.map((item) =>
        !Array.isArray(item.threads) || !item.threads.some((thread) => thread.activity?.available)
            ? item
            : {
                  ...item,
                  threads: item.threads.map((thread) => {
                      if (!thread.activity?.available) return thread;

                      const { readAt: _, ...activity } = thread.activity;

                      return { ...thread, activity };
                  }) as Item['threads'],
              },
    );
}

/** Whether any of `items` holds an activity read, whose time pages need to keep seeing. */
export const holdsActivityRead = (items: Item[]): boolean =>
    items.some((item) => Array.isArray(item.threads) && item.threads.some((thread) => thread.activity?.available));

/**
 * One refresh pass's activity reads, sharing one open database, opened once a thread at work needs it, and one read per
 * thread, whether it is at work itself or another's agent. A failed read can retain a recent action from the same run,
 * with its original read time; cached shell observations stay marked as such for every execution decision.
 */
export function activityReads(
    open: () => DatabaseSync,
    families: () => ((threadId: string) => ActivityFamily) | undefined,
    release: (db: DatabaseSync | undefined, failed: boolean) => void = (db) => db?.close(),
    previous: readonly ItemThread[] = [],
) {
    const last = new Map(previous.map((thread) => [thread.id, thread]));
    const withActivity = (thread: ItemThread, activity: ThreadActivity): ItemThread => {
        const seen = last.get(thread.id);
        const retained = seen?.activity;

        return {
            ...thread,
            activity:
                !activity.available &&
                seen &&
                retained?.available &&
                seen.state === thread.state &&
                seen.updated === thread.updated &&
                Date.now() - Date.parse(retained.readAt) < ACTIVITY_RETAIN_MS
                    ? retained
                    : activity,
        };
    };
    let db: DatabaseSync | undefined;
    let failed = false;
    let familyOf: ReturnType<typeof families> | null = null;
    const read = new Map<string, ThreadActivity>();
    const itemsRead = new Map<string, ActivityItemRow[]>();
    const agentsRead = new Map<string, ActivityAgentRow[]>();
    const once = <T>(reads: Map<string, T>, threadId: string, readRows: () => T): T => {
        if (!reads.has(threadId)) reads.set(threadId, readRows());

        return reads.get(threadId)!;
    };

    const readThread = (thread: ItemThread): ThreadActivity => {
        if (familyOf === null) familyOf = families();

        if (!familyOf) return UNAVAILABLE;

        const database = (db ??= open());
        const family = familyOf(thread.id);
        const agents = new Map<string, ActivityAgentRow>();
        const queue = [...family.threads];
        const visited = new Set<string>();

        while (queue.length) {
            const id = queue.shift()!;

            if (visited.has(id)) continue;

            visited.add(id);
            for (const row of once(agentsRead, id, () => unfinishedAgents(database, id))) {
                if (row.child === thread.id || agents.has(row.child) || !agentWorking(row, family.background.has(id)))
                    continue;

                agents.set(row.child, row);
                queue.push(row.child);
            }
        }

        return threadActivity({
            items: once(itemsRead, thread.id, () => activityItems(database, thread.id)),
            runLive: thread.state === 'running' || thread.state === 'needs you',
            agents: [...agents.values()].map((row) => ({
                row,
                items: once(itemsRead, row.child, () => activityItems(database, row.child)),
            })),
            commandRunning: family.commandRunning,
            readAt: new Date().toISOString(),
        });
    };

    return {
        /** The thread with its activity when it is at work, as T3 shows it now. A thread seen only through an outage is unavailable. */
        read: (thread: ItemThread): ItemThread => {
            if (!isLiveThread(thread) && !thread.hasRunningChildren) {
                const { activity: _, ...finished } = thread;

                return finished;
            }

            if (thread.observedAt) return withActivity(thread, UNAVAILABLE);

            let activity = read.get(thread.id);

            if (!activity) {
                try {
                    activity = readThread(thread);
                } catch {
                    failed = true;
                    activity = UNAVAILABLE;
                }

                read.set(thread.id, activity);
            }

            return withActivity(thread, activity);
        },
        close() {
            release(db, failed);
            db = undefined;
        },
    };
}
