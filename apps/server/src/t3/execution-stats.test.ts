import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { executionStats, PROJECTIONS_PER_CHUNK } from './execution-stats.ts';

test('empty complete projection has the same empty SQL row inputs', async () => {
  assert.deepEqual(await executionStats([{ thread: { id: 't' }, messages: [], providerSessions: [], providerThreads: [], providerTurns: [], runtimeRequests: [], subagents: [] }]), {
    rows: { threads: [{ id: 't', title: undefined, deletedAt: undefined, root: undefined, parent: undefined, text: undefined }], turns: [], runs: [], waits: [], lastMessages: [{ thread: 't', at: null }], active: new Set() }, sessions: [],
  });
});
test('missing execution facts cannot become empty successful stats', async () => {
  await assert.rejects(executionStats([{ thread: { id: 't' }, messages: [] }]));
});
test('turning projections into rows yields in chunks of a bounded size', async () => {
  const projection = (id: string) => ({ thread: { id }, messages: [], providerSessions: [], providerThreads: [], providerTurns: [], runtimeRequests: [], subagents: [] });
  let pauses = 0;
  const { rows } = await executionStats(Array.from({ length: PROJECTIONS_PER_CHUNK * 3 }, (_, i) => projection(`t${i}`)), async () => { pauses++; });
  assert.equal(rows.threads.length, PROJECTIONS_PER_CHUNK * 3);
  assert.equal(pauses, 3);
});
