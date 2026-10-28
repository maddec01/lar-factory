import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { agentTime } from './agent-time.ts';
import type { ThreadRows } from '../t3/t3-db.ts';

const MIN = 60_000;
const at = (minute: number) => new Date(Date.parse('2026-10-20T09:00:00Z') + minute * MIN).toISOString();

function rows(partial: Partial<ThreadRows>): ThreadRows {
  return { threads: [], turns: [], runs: [], waits: [], lastMessages: [], active: new Set(), ...partial };
}

test('an item\'s time comes from plain rows: its root\'s turns less waits, and a child\'s work outside its parent\'s', () => {
  const time = agentTime(rows({
    threads: [
      { id: 'root', title: 'root', deletedAt: null, root: 'root', parent: null, text: 'Build maddec01/Lar-Factory#7' },
      { id: 'child', title: 'child', deletedAt: null, root: 'root', parent: 'root', text: null },
      { id: 'other', title: 'other', deletedAt: null, root: 'other', parent: null, text: 'hello' },
    ],
    turns: [
      { id: 't1', thread: 'root', providerThread: 'p1', status: 'completed', startedAt: at(0), completedAt: at(10) },
      { id: 't2', thread: 'child', providerThread: 'p2', status: 'completed', startedAt: at(5), completedAt: at(20) },
    ],
    waits: [{ turn: 't1', createdAt: at(2), resolvedAt: at(4) }],
  }), Date.parse(at(60)));
  // The root works 0-2 and 4-10; the child 5-20, of which 10-20 is outside the root's work.
  assert.deepEqual(time('maddec01/lar-factory', 7), { agentMs: 18 * MIN, wallMs: 18 * MIN, threads: ['root', 'child'] });
  assert.equal(time('maddec01/lar-factory', 8), null);
});

test('an open turn on an active provider thread runs up to now; on an idle one it stops at the thread\'s last activity', () => {
  const now = Date.parse(at(30));
  const threads = [{ id: 'root', title: 'root', deletedAt: null, root: 'root', parent: null, text: 'Build x/y#1' }];
  const turns = [{ id: 't', thread: 'root', providerThread: 'p', status: 'running', startedAt: at(0), completedAt: null }];
  const lastMessages = [{ thread: 'root', at: at(12) }];
  assert.equal(agentTime(rows({ threads, turns, lastMessages, active: new Set(['p']) }), now)('x/y', 1)?.agentMs, 30 * MIN);
  assert.equal(agentTime(rows({ threads, turns, lastMessages }), now)('x/y', 1)?.agentMs, 12 * MIN);
});
