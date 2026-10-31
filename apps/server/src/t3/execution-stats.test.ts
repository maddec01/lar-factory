import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { executionStats } from './execution-stats.ts';

test('empty complete projection has the same empty SQL row inputs', () => {
  assert.deepEqual(executionStats([{ thread: { id: 't' }, messages: [], providerSessions: [], providerThreads: [], providerTurns: [], runtimeRequests: [], subagents: [] }]), {
    rows: { threads: [{ id: 't', title: undefined, deletedAt: undefined, root: undefined, parent: undefined, text: undefined }], turns: [], runs: [], waits: [], lastMessages: [{ thread: 't', at: null }], active: new Set() }, sessions: [],
  });
});
test('missing execution facts cannot become empty successful stats', () => {
  assert.throws(() => executionStats([{ thread: { id: 't' }, messages: [] }]));
});
