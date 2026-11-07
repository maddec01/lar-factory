// Spawned board fixtures record a launch where the fake t3 records its calls, and answer like T3. Never reaches a real T3.
import { appendFileSync } from 'node:fs';

import type { LaunchThread } from '../src/t3/launch-thread.ts';

export const launchThread: LaunchThread = async (projectId, text, selection, workspace, runtimeMode) => {
    appendFileSync(
        `${process.env.FAKE_GH_STATE}.t3calls`,
        `${JSON.stringify(['launch', projectId, text, selection, workspace, runtimeMode])}\n`,
    );
    return { thread: { threadId: 'thread-1', title: text.split('\n')[0] ?? text }, error: null };
};
