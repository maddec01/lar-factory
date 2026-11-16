import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { executionStats } from './execution-stats.ts';

test('empty complete projection has the same empty SQL row inputs', async () => {
    assert.deepEqual(
        await executionStats([
            {
                thread: { id: 't' },
                messages: [],
                providerSessions: [],
                providerThreads: [],
                providerTurns: [],
                runtimeRequests: [],
                subagents: [],
            },
        ]),
        {
            rows: {
                threads: [
                    {
                        id: 't',
                        title: undefined,
                        deletedAt: undefined,
                        root: undefined,
                        parent: undefined,
                        text: undefined,
                    },
                ],
                turns: [],
                runs: [],
                waits: [],
                lastMessages: [{ thread: 't', at: null }],
                active: new Set(),
            },
            sessions: [],
        },
    );
});
test('missing execution facts cannot become empty successful stats', async () => {
    await assert.rejects(executionStats([{ thread: { id: 't' }, messages: [] }]));
});
