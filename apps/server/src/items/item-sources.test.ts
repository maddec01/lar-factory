import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item, Status } from '@lar-factory/shared';
import { ReadProblem, type ItemSource } from './item-source.ts';
import type { RepositoryConfig } from '../config/repository-config.ts';
import { fakeAz } from '../azure/fake-az.ts';
import { configuredSources, mergeSources, onboardedSources } from './item-sources.ts';

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
  const read = await mergeSources([project], new Map([['maddec01/lar-apple', issues]])).read();
  assert.equal(read.title, 'lar');
  assert.deepEqual(read.items.map((i) => [i.id, i.status]), [['I_1', 'In progress'], ['I_2', 'List']]);
});

test("with Opted-in items, an issue shows only while it carries a status, closed or not; a Project item shows once closed", async () => {
  const bare = (id: string, repo: string, state: Item['state'] = 'open'): Item => ({ ...item(id, repo), statuses: [], state, closedAs: state === 'closed' ? 'done' : null });
  const closed = (id: string, repo: string, status: Status): Item => ({ ...item(id, repo, status), state: 'closed', closedAs: 'done' });
  const project = fakeSource('lar', [bare('I_1', 'maddec01/lar-server'), bare('I_2', 'maddec01/lar-factory'), item('I_3', 'maddec01/lar-factory', 'Queued'),
    bare('I_4', 'maddec01/lar-factory', 'closed')], []);
  const issues = fakeSource('apple', [bare('I_5', 'maddec01/lar-apple'), item('I_6', 'maddec01/lar-apple', 'List'), bare('I_7', 'maddec01/lar-apple', 'closed'),
    closed('I_8', 'maddec01/lar-apple', 'Verify')], []);
  const read = await mergeSources([project], new Map([['maddec01/lar-apple', issues]]), ['maddec01/lar-apple', 'Maddec01/Lar-Factory']).read();
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_3', 'I_4', 'I_6', 'I_8']);
});

test('a source with no opted-in repositories lists every item it read', async () => {
  const project = fakeSource('lar', [{ ...item('I_1', 'maddec01/lar-server'), statuses: [] }], []);
  const issues = fakeSource('apple', [{ ...item('I_2', 'maddec01/lar-apple'), statuses: [] }], []);
  const read = await mergeSources([project], new Map([['maddec01/lar-apple', issues]])).read();
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_2']);
});

test('a write goes to the source that listed the item, or else to the source its repository names', async () => {
  const writes: string[] = [];
  const project = fakeSource('lar', [item('I_1', 'maddec01/lar-apple')], writes);
  const issues = fakeSource('apple', [item('I_1', 'maddec01/lar-apple'), item('I_2', 'maddec01/lar-apple')], writes);
  const sources = mergeSources([project], new Map([['maddec01/lar-apple', issues]]));
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
  const sources = mergeSources([project], new Map([['maddec01/lar-apple', issues]]));
  await sources.read();
  assert.equal(sources.statusRefusal(item('I_1', 'maddec01/lar-apple')), 'lar refuses I_1');
  assert.equal(sources.statusRefusal(item('I_2', 'maddec01/lar-apple')), 'apple refuses I_2');
  assert.equal(sources.statusRefusal({ number: 5, title: 'Parent', url: '', repo: 'maddec01/lar-apple', state: 'open' }), 'apple refuses maddec01/lar-apple#5');
  assert.equal(sources.statusRefusal({ number: 6, title: 'Parent', url: '', repo: 'maddec01/lar-server', state: 'open' }), 'lar refuses maddec01/lar-server#6');
});

test('a saved id is renamed by whichever source knows it', () => {
  const sources = mergeSources([fakeSource('lar', [], [])], new Map([['maddec01/lar-apple', fakeSource('apple', [], [])]]));
  assert.equal(sources.renamedId?.('PVTI_lar'), 'I_lar');
  assert.equal(sources.renamedId?.('PVTI_apple'), 'I_apple');
  assert.equal(sources.renamedId?.('PVTI_other'), undefined);
});

test("a read fails whole when a source fails, and another source's error starts with its repository", async () => {
  const failing = (message: string): ItemSource => ({ ...fakeSource('x', [], []), read: async () => { throw new Error(message); } });
  const project = fakeSource('lar', [item('I_1', 'maddec01/lar-server')], []);
  const issues = mergeSources([project], new Map([['maddec01/lar-apple', failing('Could not resolve to a Repository')]]));
  await assert.rejects(issues.read(), { message: 'maddec01/lar-apple: Could not resolve to a Repository' });
  const projectFails = mergeSources([failing('gh: not logged in')], new Map([['maddec01/lar-apple', fakeSource('apple', [], [])]]));
  await assert.rejects(projectFails.read(), { message: 'gh: not logged in' });
});

test('two Projects each write for their own repositories, and a repository no source names takes the first', async () => {
  const writes: string[] = [];
  const lar = fakeSource('lar', [], writes);
  const other = fakeSource('other', [], writes);
  const sources = mergeSources([lar, other], new Map([['maddec01/lar-server', lar], ['fabrikam/api', other]]));
  assert.equal((await sources.read()).title, 'lar');
  for (const repo of ['maddec01/lar-server', 'Fabrikam/API', 'maddec01/elsewhere']) await sources.create({ kind: 'feature', repo, title: 'New', description: '', labels: [] }, {});
  assert.deepEqual(writes, ['lar create maddec01/lar-server', 'other create Fabrikam/API', 'lar create maddec01/elsewhere']);
});

test('with no source a read lists nothing and a write is refused', async () => {
  const sources = mergeSources([], new Map());
  assert.deepEqual(await sources.read(), { title: '', items: [] });
  assert.equal(await sources.setStatus(item('I_1', 'maddec01/lar-server'), 'Queued'), "That item's repository isn't onboarded.");
});

const config = (repo: string, show: RepositoryConfig['show'] = 'all'): RepositoryConfig =>
  ({ repo, version: 1, role: 'role', itemSource: { kind: 'issues' }, show, labels: [] });

test('each read loads the configs first and builds the sources again only when they changed', async () => {
  let configs = [config('maddec01/lar-apple')];
  const built: string[][] = [];
  const sources = onboardedSources(async () => ({ configs, problems: [], resetting: [] }), (read) => {
    built.push(read.map((c) => `${c.repo} ${c.show}`));
    return fakeSource(read.map((c) => c.repo).join(',') || 'none', [], []);
  });
  assert.deepEqual(sources.repos(), []);
  assert.equal((await sources.read()).title, 'maddec01/lar-apple');
  await sources.read();
  configs = [{ ...config('maddec01/lar-apple', 'opted-in'), labels: ['app: music'] }, config('maddec01/lar-server')];
  assert.equal((await sources.read()).title, 'maddec01/lar-apple,maddec01/lar-server');
  assert.deepEqual(built, [[], ['maddec01/lar-apple all'], ['maddec01/lar-apple opted-in', 'maddec01/lar-server all']]);
  assert.deepEqual(sources.repos(), [{ repo: 'maddec01/lar-apple', role: 'role', items: 'issues', show: 'opted-in', labels: ['app: music'] },
    { repo: 'maddec01/lar-server', role: 'role', items: 'issues', show: 'all', labels: [] }]);
});

test("a read whose configs can't be loaded fails, and writes keep going to the last sources", async () => {
  const writes: string[] = [];
  let fail = false;
  const sources = onboardedSources(async () => {
    if (fail) throw new Error('repositories.json isn\'t valid JSON.');
    return { configs: [config('maddec01/lar-apple')], problems: [], resetting: [] };
  }, () => fakeSource('apple', [], writes));
  await sources.read();
  fail = true;
  await assert.rejects(sources.read(), /valid JSON/);
  await sources.setStatus(item('I_1', 'maddec01/lar-apple'), 'Queued');
  assert.deepEqual(writes, ['apple I_1 Queued']);
  assert.equal(sources.repos().length, 1);
});

test("a read leaves out the items of a repository whose config couldn't be read, though its Project lists them", async () => {
  const listed = [item('I_1', 'maddec01/lar-server'), item('I_2', 'maddec01/lar-apple'), item('I_3', 'maddec01/LAR-APPLE')];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-server')],
    problems: [{ repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' }], resetting: [] }), () => fakeSource('lar', listed, []));
  assert.deepEqual((await sources.read()).items.map((i) => i.id), ['I_1']);
});

test('a read leaves out the items of a resetting repository, though its Project lists them', async () => {
  const listed = [item('I_1', 'maddec01/lar-server'), item('I_2', 'maddec01/lar-apple'), item('I_3', 'maddec01/LAR-APPLE')];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-server')], problems: [], resetting: ['maddec01/lar-apple'] }),
    () => fakeSource('lar', listed, []));
  assert.deepEqual((await sources.read()).items.map((i) => i.id), ['I_1']);
});

const azure = (repo: string, team = 'Fabrikam Team', show: RepositoryConfig['show'] = 'all'): RepositoryConfig =>
  ({ repo, version: 1, role: 'role', itemSource: { kind: 'azure-sprint', team }, show, labels: [] });

test("repositories reading one team's sprint share one read, and an untagged item from it is for each of them", async () => {
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }, { id: 2, type: 'User Story', state: 'New', tags: 'repo-api' }] });
  const sources = configuredSources([azure('contoso/Fabrikam/web'), azure('Contoso/fabrikam/api', 'fabrikam team'), azure('contoso/Fabrikam/docs', 'Docs Team')], az.run);
  const read = await sources.read();
  // The docs team's sprint is the same fake sprint, read apart; its copy of an item the web sprint listed shows once.
  assert.deepEqual(read.items.map((i) => [i.number, i.repo, i.untaggedFor ?? null]), [
    [1, 'contoso/Fabrikam/web', ['contoso/Fabrikam/web', 'Contoso/fabrikam/api']], [2, 'Contoso/fabrikam/api', null],
  ]);
  assert.equal(az.calls.filter((c) => c[3] === 'list-work-items').length, 2, 'one sprint read per team');
});

test("with Opted-in items, an untagged item that carries no status leaves the Lists of the opted-in repositories", async () => {
  const bare = (id: string, untaggedFor: string[]): Item => ({ ...item(id, untaggedFor[0]!), statuses: [], untaggedFor });
  const sprint = fakeSource('sprint', [bare('I_1', ['contoso/p/web', 'contoso/p/api']), bare('I_2', ['contoso/p/web']), { ...bare('I_3', ['contoso/p/web']), statuses: ['List'] }], []);
  const read = await mergeSources([], new Map([['contoso/p/web', sprint], ['contoso/p/api', sprint]]), ['Contoso/P/Web']).read();
  assert.deepEqual(read.items.map((i) => [i.id, i.repo, i.untaggedFor]), [['I_1', 'contoso/p/api', ['contoso/p/api']], ['I_3', 'contoso/p/web', ['contoso/p/web']]]);
});

test('a problem with a source that repositories share shows under each of them', async () => {
  const sprint: ItemSource = { ...fakeSource('sprint', [], []), read: async () => { throw new ReadProblem('az is logged out.', 'az login'); } };
  const read = await mergeSources([], new Map([['contoso/p/web', sprint], ['contoso/p/api', sprint]])).read();
  assert.deepEqual(read.problems, [{ repo: 'contoso/p/web', problem: 'az is logged out.', fix: 'az login' }, { repo: 'contoso/p/api', problem: 'az is logged out.', fix: 'az login' }]);
});

/** A source whose read finishes when `finish` is called. */
function slowSource(name: string): { source: ItemSource; finish: () => void } {
  let finish = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  return { source: { ...fakeSource(name, [], []), name, read: async () => { await done; return { title: name, items: [] }; } }, finish };
}

test('a read marks each source as started at once and as finished when its own read ends, without waiting for the others', async () => {
  const fast = slowSource('lar-apple');
  const slow = slowSource('Project maddec01/1');
  const events: string[] = [];
  const progress = { started: (name: string) => events.push(`+${name}`), finished: (name: string) => events.push(`-${name}`) };
  const read = mergeSources([slow.source], new Map([['maddec01/lar-apple', fast.source]])).read(progress);
  assert.deepEqual(events, ['+Project maddec01/1', '+lar-apple']);
  fast.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.slice(2), ['-lar-apple'], 'the fast read reports before the slow one ends');
  slow.finish();
  await read;
  assert.deepEqual(events.slice(3), ['-Project maddec01/1']);
});

test("a source without a name is named by its repositories, and a failed read still finishes", async () => {
  const events: string[] = [];
  const progress = { started: (name: string) => events.push(`+${name}`), finished: (name: string) => events.push(`-${name}`) };
  const failing: ItemSource = { ...fakeSource('x', [], []), read: async () => { throw new Error('boom'); } };
  const sources = mergeSources([], new Map([['contoso/p%20q/web', failing], ['contoso/p%20q/api', failing]]));
  await assert.rejects(sources.read(progress), /boom/);
  assert.deepEqual(events, ['+web, api', '-web, api']);
});

test('the onboarded sources pass the progress to the sources they build', async () => {
  const events: string[] = [];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-apple')], problems: [], resetting: [] }), () => ({
    ...fakeSource('lar', [], []), read: async (progress) => { progress?.started('lar'); progress?.finished('lar'); return { title: 'lar', items: [] }; } }));
  await sources.read({ started: (name) => events.push(`+${name}`), finished: (name) => events.push(`-${name}`) });
  assert.deepEqual(events, ['+lar', '-lar']);
});
