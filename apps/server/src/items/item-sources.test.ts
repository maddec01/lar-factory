import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item, Status } from '@lar-factory/shared';
import type { ItemSource } from './item-source.ts';
import { mergeSources } from './item-sources.ts';

const item = (id: string, repo: string, status: Status = 'List'): Item => ({
  id, status, statuses: [status], content: 'ticket', number: Number(id.slice(2)), title: id, url: `https://github.com/${repo}/issues/${id.slice(2)}`, repo,
  labels: [], state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
  updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
});

/** A source that lists `items` and records each write it is asked for. */
function fakeSource(title: string, items: Item[], writes: string[]): ItemSource {
  const write = (what: string) => async () => { writes.push(`${title} ${what}`); return null; };
  return {
    read: async () => ({ title, items }),
    setStatus: async (i, status) => write(`${i.id} ${status}`)(),
    statusRefusal: (i) => `${title} refuses ${'id' in i ? i.id : `${i.repo}#${i.number}`}`,
    addLabel: async (i, label) => write(`${i.id} ${label}`)(),
    create: async (draft) => { writes.push(`${title} create ${draft.repo}`); return { item: null, issueUrl: null, error: null }; },
    setParentStatus: async (parent, status) => write(`${parent.repo}#${parent.number} ${status}`)(),
    abandon: async (i) => write(`abandon ${i.id}`)(),
    renamedId: (savedId) => (savedId === `PVTI_${title}` ? `I_${title}` : undefined),
  };
}

test("a read lists every source's items under the Project's title, an item two sources list once, with the Project's copy", async () => {
  const writes: string[] = [];
  const project = fakeSource('lar', [item('I_1', 'maddec01/lar-server', 'In progress')], writes);
  const issues = fakeSource('maddec01/lar-apple', [item('I_1', 'maddec01/lar-server'), item('I_2', 'maddec01/lar-apple')], writes);
  const read = await mergeSources(project, new Map([['maddec01/lar-apple', issues]])).read();
  assert.equal(read.title, 'lar');
  assert.deepEqual(read.items.map((i) => [i.id, i.status]), [['I_1', 'In progress'], ['I_2', 'List']]);
});

test('a write goes to the source that listed the item, or else to the source its repository names', async () => {
  const writes: string[] = [];
  const project = fakeSource('lar', [item('I_1', 'maddec01/lar-apple')], writes);
  const issues = fakeSource('apple', [item('I_1', 'maddec01/lar-apple'), item('I_2', 'maddec01/lar-apple')], writes);
  const sources = mergeSources(project, new Map([['maddec01/lar-apple', issues]]));
  await sources.read();
  await sources.setStatus(item('I_1', 'maddec01/lar-apple'), 'Queued');
  await sources.addLabel(item('I_2', 'maddec01/lar-apple'), 'build');
  await sources.abandon(item('I_9', 'maddec01/lar-server'));
  await sources.create({ kind: 'feature', repo: 'maddec01/lar-apple', title: 'New', description: '', labels: [] }, {});
  await sources.create({ kind: 'feature', repo: 'maddec01/lar-server', title: 'New', description: '', labels: [] }, {});
  await sources.setParentStatus({ number: 5, title: 'Parent', url: '', repo: 'maddec01/lar-apple', state: 'open' }, 'In progress');
  assert.deepEqual(writes, ['lar I_1 Queued', 'apple I_2 build', 'lar abandon I_9', 'apple create maddec01/lar-apple',
    'lar create maddec01/lar-server', 'apple maddec01/lar-apple#5 In progress']);
});

test('a status refusal comes from the source that listed the item, or else the source its repository names', async () => {
  const project = fakeSource('lar', [item('I_1', 'maddec01/lar-apple')], []);
  const issues = fakeSource('apple', [item('I_1', 'maddec01/lar-apple'), item('I_2', 'maddec01/lar-apple')], []);
  const sources = mergeSources(project, new Map([['maddec01/lar-apple', issues]]));
  await sources.read();
  assert.equal(sources.statusRefusal(item('I_1', 'maddec01/lar-apple')), 'lar refuses I_1');
  assert.equal(sources.statusRefusal(item('I_2', 'maddec01/lar-apple')), 'apple refuses I_2');
  assert.equal(sources.statusRefusal({ number: 5, title: 'Parent', url: '', repo: 'maddec01/lar-apple', state: 'open' }), 'apple refuses maddec01/lar-apple#5');
  assert.equal(sources.statusRefusal({ number: 6, title: 'Parent', url: '', repo: 'maddec01/lar-server', state: 'open' }), 'lar refuses maddec01/lar-server#6');
});

test('a saved id is renamed by whichever source knows it', () => {
  const sources = mergeSources(fakeSource('lar', [], []), new Map([['maddec01/lar-apple', fakeSource('apple', [], [])]]));
  assert.equal(sources.renamedId?.('PVTI_lar'), 'I_lar');
  assert.equal(sources.renamedId?.('PVTI_apple'), 'I_apple');
  assert.equal(sources.renamedId?.('PVTI_other'), undefined);
});

test("a read fails whole when a source fails, and another source's error starts with its repository", async () => {
  const failing = (message: string): ItemSource => ({ ...fakeSource('x', [], []), read: async () => { throw new Error(message); } });
  const project = fakeSource('lar', [item('I_1', 'maddec01/lar-server')], []);
  const issues = mergeSources(project, new Map([['maddec01/lar-apple', failing('Could not resolve to a Repository')]]));
  await assert.rejects(issues.read(), { message: 'maddec01/lar-apple: Could not resolve to a Repository' });
  const projectFails = mergeSources(failing('gh: not logged in'), new Map([['maddec01/lar-apple', fakeSource('apple', [], [])]]));
  await assert.rejects(projectFails.read(), { message: 'gh: not logged in' });
});
