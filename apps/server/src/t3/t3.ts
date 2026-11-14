// Starts T3 Code threads, and adds onboarding's new T3 projects, through the local `t3` CLI.

import { isRecord, type ModelSelection, type StartedThread, type StartResult } from '@lar-factory/shared';

import { runTool, type RunResult } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';
import { developmentModel } from './development-model.ts';
import {
    launchThread,
    type ExistingWorktree,
    type LaunchContext,
    type LaunchThread,
    type LaunchWorkspace,
} from './launch-thread.ts';
import { launchSelection, projectDefaults, type ProjectDefaults } from './model-choices.ts';

const UNCERTAIN: StartResult = {
    thread: null,
    uncertain: true,
    error: "The thread's start could not be confirmed. Check its T3 project in T3 Code before starting it again.",
};

/** A new git worktree for a thread: the branch it is made on, from `base`. */
export interface NewWorktree {
    base: string;
    branch: string;
}

/**
 * A model choice launches through T3's `orchestration.launchThread`, whose selection can hold options, which the CLI's
 * can't. Record-backed starts resolve Project default too, so its request can be replayed. Without a readable selection,
 * `t3 thread start <project id> <message> --json` lets T3 choose; `worktree`
 * adds `--worktree <base> --branch <branch>` to run the thread in a new worktree instead of the project's folder.
 */
export async function startThread(
    project: string,
    message: string,
    choice?: ModelSelection,
    worktree?: NewWorktree | ExistingWorktree,
    run: T3Run = runT3,
    defaults: (project: string) => ProjectDefaults | null = projectDefaults,
    launch: LaunchThread = launchThread,
    context?: LaunchContext,
): Promise<StartResult> {
    const development = developmentModel();
    const selected = choice ?? development ?? (context ? (defaults(project)?.selection ?? undefined) : undefined);
    const existing = worktree && 'type' in worktree ? worktree : undefined;
    const created = worktree && !('type' in worktree) ? worktree : undefined;

    if (existing && !selected)
        return { thread: null, error: 'Choose a model before continuing in an existing worktree.' };

    if (selected) {
        const found = defaults(project);

        if (!found) return { thread: null, error: "Can't read T3 Code's settings. Check T3 Code, then start again." };

        const selection =
            choice?.options !== undefined ? choice : launchSelection(selected, development ?? found.selection);

        const send: LaunchThread = (projectId, text, model, workspace, mode) =>
            context
                ? launch(projectId, text, model, workspace, mode, undefined, context.commandId, context.remember)
                : launch(projectId, text, model, workspace, mode);

        // A resumed build's message matches its earlier thread, so a lost answer stays uncertain rather than finding that one.
        if (existing) {
            const result = await send(project, message, selection, existing, found.runtimeMode);

            return result.uncertain && !context ? UNCERTAIN : result;
        }

        const workspace: LaunchWorkspace = created
            ? { type: 'worktree', baseRef: created.base, branch: created.branch }
            : { type: 'root' };
        const result = await send(project, message, selection, workspace, found.runtimeMode);

        return result.uncertain && !context ? recoverStart(project, message, run) : result;
    }

    const where = created ? ['--worktree', created.base, '--branch', created.branch] : [];
    const missing = `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.`;
    let result: RunResult;

    try {
        result = await run(['thread', 'start', project, message, ...where, '--json'], 60_000);
    } catch {
        return recoverStart(project, message, run);
    }

    const { code, stdout } = result;

    if (code === 'ENOENT') return { thread: null, error: missing };

    // A failed command can have created a thread before losing its answer.
    if (code !== 0) return recoverStart(project, message, run);

    try {
        const launched = JSON.parse(stdout) as { threadId?: unknown; title?: unknown };

        if (typeof launched.threadId !== 'string' || !launched.threadId) throw new Error('No thread id.');

        // T3 titles a thread from the first line of its first message.
        const title = typeof launched.title === 'string' ? launched.title : (message.split('\n')[0] ?? message);

        return { thread: { threadId: launched.threadId, title }, error: null };
    } catch {
        return recoverStart(project, message, run);
    }
}

/** List/show can recover a late launch; absence or ambiguity never permits a retry. */
async function recoverStart(project: string, message: string, run: T3Run): Promise<StartResult> {
    const found = await findStartedThread(project, [message], [], run);

    return typeof found === 'object' ? { thread: found, error: null } : UNCERTAIN;
}

/** Whether T3 could have titled a thread `title` from `message`: from its first line, which T3 cuts short with an ellipsis when long. */
export function titledFrom(title: unknown, message: string): boolean {
    const line = message.split('\n')[0]!;

    return title === line || (typeof title === 'string' && title.endsWith('…') && line.startsWith(title.slice(0, -1)));
}

/**
 * The one thread in `project` whose first user message is any of `messages`, leaving out the `known` thread IDs a record
 * already holds: 'absent' once t3 lists none, 'unknown' when its answer can't be read or names more than one.
 */
export async function findStartedThread(
    project: string,
    messages: readonly string[],
    known: readonly string[],
    run: T3Run = runT3,
): Promise<StartedThread | 'absent' | 'empty' | 'unknown'> {
    try {
        const listed = await run(['thread', 'list', '--project', project, '--json'], 10_000);

        if (listed.code !== 0) return 'unknown';

        const threads: unknown = JSON.parse(listed.stdout);

        if (!Array.isArray(threads)) return 'unknown';

        const matches = new Map<string, StartedThread>();
        let empty = false;

        for (const thread of threads) {
            if (!isRecord(thread) || typeof thread.threadId !== 'string') return 'unknown';

            if (!messages.some((message) => titledFrom(thread.title, message)) || known.includes(thread.threadId))
                continue;

            const shown = await run(['thread', 'show', thread.threadId, '--json', '--messages', '2147483647'], 10_000);

            if (shown.code !== 0) return 'unknown';

            const answer: unknown = JSON.parse(shown.stdout);

            if (
                !isRecord(answer) ||
                !isRecord(answer.thread) ||
                answer.thread.threadId !== thread.threadId ||
                !Array.isArray(answer.messages)
            )
                return 'unknown';

            const first = answer.messages.find((entry) => isRecord(entry) && entry.role === 'user');

            if (!first) empty = true;

            if (isRecord(first) && messages.some((message) => first.text === message))
                matches.set(thread.threadId, { threadId: thread.threadId, title: String(thread.title) });
        }

        return empty ? 'empty' : matches.size === 1 ? [...matches.values()][0]! : matches.size ? 'unknown' : 'absent';
    } catch {
        return 'unknown';
    }
}

/** Runs `t3` with these arguments and timeout; tests pass a stub. */
export type T3Run = (args: string[], timeout: number) => Promise<RunResult>;

const runT3: T3Run = (args, timeout) => {
    const command = toolCommand('t3');

    if (!command) return Promise.resolve({ code: 'ENOENT', stdout: '', stderr: '', detail: '' });

    return runTool(command.file, args, { env: command.env, timeout });
};

/** Runs `t3 project add <folder>`, returning null once T3 added it, else the problem. */
export async function addProject(folder: string): Promise<string | null> {
    const command = toolCommand('t3');
    const missing = `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.`;

    if (!command) return missing;

    const { code, detail } = await runTool(command.file, ['project', 'add', folder], {
        env: command.env,
        timeout: 60_000,
    });

    if (code === 'ENOENT') return missing;

    if (code === 0) return null;

    // A signal, such as our timeout, leaves it unknown whether T3 added the folder.
    if (code === null) return "t3 didn't answer in time. Check T3 Code's projects before adding the folder again.";

    return `t3 could not add the project: ${detail}`;
}

/** Confirms deletion only from the CLI's exact unavailable response. */
export async function lookupThread(id: string, run: T3Run = runT3): Promise<'live' | 'deleted' | 'unknown'> {
    try {
        const result = await run(['thread', 'show', id, '--json', '--messages', '0'], 10_000);

        if (
            result.code === 1 &&
            result.stdout === '' &&
            result.stderr.trim() === `Thread ${id} is no longer available.`
        )
            return 'deleted';

        if (result.code === 0) {
            const answer: unknown = JSON.parse(result.stdout);

            if (isRecord(answer) && isRecord(answer.thread) && answer.thread.threadId === id) return 'live';
        }
    } catch {
        /* A failed lookup leaves the Start protected. */
    }

    return 'unknown';
}
