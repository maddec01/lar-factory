import type { ThreadLaunchRequest } from '@lar-factory/shared';
// Spawned board fixtures record a launch where the fake t3 records its calls, and answer like T3. Never reaches a real T3.
import { executionSettingsOf } from '@lar-factory/shared/execution-target';
import { appendFileSync, readFileSync } from 'node:fs';

import type { LaunchThread } from '../src/t3/launch-thread.ts';

export const launchThread: LaunchThread = async (projectId, text, selection, workspace, runtimeMode) => {
    appendFileSync(
        `${process.env.FAKE_GH_STATE}.t3calls`,
        `${JSON.stringify(['launch', projectId, text, selection, workspace, runtimeMode])}\n`,
    );

    const options = JSON.parse(readFileSync(process.env.FAKE_GH_STATE!, 'utf8')).t3 ?? {};

    if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));

    if (options.fail === 'refused') return { thread: null, error: 'T3 launch authorization failed.' };

    if (options.fail) return { thread: null, uncertain: true, error: 'T3 launch could not be confirmed.' };

    const launches = readFileSync(`${process.env.FAKE_GH_STATE}.t3calls`, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((call) => call[0] === 'launch').length;
    const threadId = `thread-${launches}`;

    return {
        thread: { threadId, title: text.split('\n')[0] ?? text },
        error: null,
        executionReport: { source: 't3', reference: threadId, actual: executionSettingsOf(selection) },
    };
};

export const resumeLaunch = (request: ThreadLaunchRequest, commandId: string) =>
    launchThread(
        request.projectId,
        request.text,
        request.selection,
        request.workspace,
        request.runtimeMode,
        undefined,
        commandId,
    );
