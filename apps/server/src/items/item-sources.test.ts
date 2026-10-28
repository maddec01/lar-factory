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

/** The source as the one Project of a merged source, as onboardedSources builds one. */
const merged = (source: ItemSource) => mergeSources([source], new Map());

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
    return merged(fakeSource(read.map((c) => c.repo).join(',') || 'none', [], []));
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
  }, () => merged(fakeSource('apple', [], writes)));
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
    problems: [{ repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' }], resetting: [] }), () => merged(fakeSource('lar', listed, [])));
  assert.deepEqual((await sources.read()).items.map((i) => i.id), ['I_1']);
});

test('a read leaves out the items of a resetting repository, though its Project lists them', async () => {
  const listed = [item('I_1', 'maddec01/lar-server'), item('I_2', 'maddec01/lar-apple'), item('I_3', 'maddec01/LAR-APPLE')];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-server')], problems: [], resetting: ['maddec01/lar-apple'] }),
    () => merged(fakeSource('lar', listed, [])));
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
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-apple')], problems: [], resetting: [] }),
    () => merged({ ...fakeSource('lar', [], []), name: 'lar' }));
  await sources.read({ started: (name) => events.push(`+${name}`), finished: (name) => events.push(`-${name}`) });
  assert.deepEqual(events, ['+lar', '-lar']);
});

/** A source that counts its reads and lists `items` as they are at each read. */
function countedSource(name: string, items: () => Item[]): ItemSource & { reads: number } {
  const source = { ...fakeSource(name, [], []), name, reads: 0, read: async () => { source.reads++; return { title: name, items: items() }; } };
  return source;
}

const pace = (now: number, active: (i: Item) => boolean = (i) => i.status === 'In progress') => ({ now, active, polled: (i: Item) => i.status === 'Review' });

test('a paced read reads a source with active work every 15 seconds and an idle one every 5 minutes', async () => {
  const busy = countedSource('busy', () => [item('I_1', 'maddec01/lar-apple', 'In progress')]);
  const idle = countedSource('idle', () => [item('I_2', 'maddec01/lar-server', 'Queued')]);
  const sources = mergeSources([], new Map([['maddec01/lar-apple', busy], ['maddec01/lar-server', idle]]));
  await sources.read(undefined, pace(0));
  assert.equal(sources.due(pace(14_999)), false);
  const read = await sources.read(undefined, pace(15_000));
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_2'], 'the idle source lists its items from its last read');
  assert.deepEqual([busy.reads, idle.reads], [2, 1]);
  assert.equal(sources.readAfresh(read.items[0]!), true);
  assert.equal(sources.readAfresh(read.items[1]!), false);
  await sources.read(undefined, pace(300_000));
  assert.deepEqual([busy.reads, idle.reads], [3, 2]);
  await sources.read(undefined, { ...pace(330_000), slow: true });
  assert.deepEqual([busy.reads, idle.reads], [3, 2], 'a slow pace keeps even active work on the idle cadence');
});

test('invalidating an item reads only the source that lists it, at once, and an unknown one reads its repository\'s source', async () => {
  const apple = countedSource('apple', () => [{ ...item('I_1', 'maddec01/lar-apple'), slices: [{ number: 9, title: 's', url: 'https://github.com/maddec01/lar-apple/issues/9', state: 'open', repo: 'maddec01/lar-apple', progress: 'active' }] }]);
  const server = countedSource('server', () => [item('I_2', 'maddec01/lar-server')]);
  const sources = mergeSources([], new Map([['maddec01/lar-apple', apple], ['maddec01/lar-server', server]]));
  await sources.read(undefined, pace(0));
  sources.invalidate('https://github.com/maddec01/lar-apple/issues/9');
  assert.equal(sources.due(pace(1_999)), false, 'two reads of one source are at least 2 seconds apart');
  await sources.read(undefined, pace(2_000));
  assert.deepEqual([apple.reads, server.reads], [2, 1]);
  sources.invalidate('https://github.com/maddec01/lar-apple/issues/404');
  await sources.read(undefined, pace(4_000));
  assert.deepEqual([apple.reads, server.reads], [3, 1]);
});

test('a source whose read failed is read again, while one that read keeps its read', async () => {
  let fail = true;
  const good = countedSource('good', () => [item('I_1', 'maddec01/lar-apple')]);
  const flaky: ItemSource & { reads: number } = { ...countedSource('flaky', () => []), read: async () => {
    flaky.reads++;
    if (fail) throw new Error('boom');
    return { title: 'flaky', items: [item('I_2', 'maddec01/lar-server')] };
  } };
  const sources = mergeSources([], new Map([['maddec01/lar-apple', good], ['maddec01/lar-server', flaky]]));
  await assert.rejects(sources.read(undefined, pace(0)), /boom/);
  fail = false;
  assert.equal(sources.due(pace(14_999)), false, 'a source that never read retries at the active pace');
  const read = await sources.read(undefined, pace(15_000));
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_2']);
  assert.deepEqual([good.reads, flaky.reads], [1, 2]);
});

test('a paced read loads the configs again only every 5 minutes, or after reload', async () => {
  let loads = 0;
  const sources = onboardedSources(async () => { loads++; return { configs: [config('maddec01/lar-apple')], problems: [], resetting: [] }; },
    () => merged(fakeSource('lar', [], [])));
  await sources.read(undefined, pace(0));
  await sources.read(undefined, pace(299_999));
  assert.equal(loads, 1);
  sources.reload();
  assert.equal(sources.due(pace(1_999)), false, 'a reload waits out the 2 seconds since the last load, as the sources do');
  assert.equal(sources.due(pace(2_000)), true);
  await sources.read(undefined, pace(2_000));
  await sources.read(undefined, pace(302_000));
  assert.equal(loads, 3);
});

test('a source that reads items alone reads only its active and asked-for items between its whole reads', async () => {
  let listed = [item('I_1', 'maddec01/lar-apple', 'In progress'), item('I_2', 'maddec01/lar-apple', 'Queued'), item('I_3', 'maddec01/lar-apple', 'Queued')];
  const some: string[][] = [];
  const project = Object.assign(countedSource('project', () => listed), { readSome: async (items: Item[]) => {
    some.push(items.map((i) => i.id));
    return listed.filter((i) => items.some((asked) => asked.id === i.id));
  } });
  const sources = mergeSources([project], new Map());
  await sources.read(undefined, pace(0));
  listed = [{ ...listed[0]!, status: 'Review', statuses: ['Review'] }, listed[1]!];
  const read = await sources.read(undefined, pace(15_000));
  assert.deepEqual([project.reads, some], [1, [['I_1']]]);
  assert.deepEqual(read.items.map((i) => `${i.id}:${i.status}`), ['I_1:Review', 'I_2:Queued', 'I_3:Queued'], 'the idle items keep their last read');
  assert.equal(sources.readAfresh(read.items[0]!), true);
  assert.equal(sources.readAfresh(read.items[1]!), false);
  sources.invalidate(listed[1]!.url!);
  sources.invalidate('https://github.com/maddec01/lar-apple/issues/3');
  const asked = await sources.read(undefined, pace(17_000));
  assert.deepEqual(some.at(-1), ['I_2', 'I_3'], 'the asked-for items read at once, alone');
  assert.deepEqual(asked.items.map((i) => i.id), ['I_1', 'I_2'], 'an asked-for item the source no longer lists leaves');
  await sources.read(undefined, pace(300_000));
  assert.equal(project.reads, 2, 'the idle interval reads it whole');
});

test('a read of a few items that fails reads the whole source instead', async () => {
  const project = Object.assign(countedSource('project', () => [item('I_1', 'maddec01/lar-apple', 'In progress')]),
    { readSome: async () => { throw new Error('Could not resolve to a node'); } });
  const sources = mergeSources([project], new Map());
  await sources.read(undefined, pace(0));
  await sources.read(undefined, pace(15_000));
  assert.equal(project.reads, 2);
});

test('a change check every 5 seconds reads the items changed elsewhere alone, and the whole source when it names one it never listed', async () => {
  const pr = { url: 'https://github.com/maddec01/lar-apple/pull/9' } as Item['linkedPrs'][number];
  const listed = [item('I_1', 'maddec01/lar-apple', 'Queued'), item('I_2', 'maddec01/lar-apple', 'Queued'), { ...item('I_3', 'maddec01/lar-apple', 'Queued'), linkedPrs: [pr] }];
  const some: string[][] = [];
  const checks: number[] = [];
  let changes: string[] | null = [];
  const project = Object.assign(countedSource('project', () => listed), {
    readSome: async (items: Item[]) => { some.push(items.map((i) => i.id)); return items; },
    changes: async (since: number) => { checks.push(since); return changes; },
  });
  const sources = mergeSources([project], new Map());
  await sources.read(undefined, pace(0));
  await sources.probe(pace(4_999));
  assert.deepEqual(checks, [], 'no check before 5 seconds');
  changes = [listed[1]!.url!, pr.url];
  await sources.probe(pace(5_000));
  assert.deepEqual(checks, [0], 'the first check looks back to the first read');
  await sources.read(undefined, pace(5_000));
  assert.deepEqual([project.reads, some], [1, [['I_2', 'I_3']]], 'a changed PR reads the item it links');
  await sources.probe({ ...pace(10_000), slow: true });
  assert.deepEqual(checks, [0], 'no check while the quota runs low');
  changes = ['https://github.com/maddec01/lar-apple/pull/7'];
  await sources.probe(pace(10_000));
  assert.deepEqual(checks, [0, 5_000]);
  await sources.read(undefined, pace(10_000));
  assert.equal(project.reads, 2, 'a URL the source never listed, as a PR that just linked an issue, reads it whole');
  changes = null;
  await sources.probe(pace(15_000));
  assert.equal(sources.due(pace(15_000)), true, "a check that can't tell reads it whole");
});

test('a source whose change check sees every edit reads only the items no check sees change, as a PR with running checks', async () => {
  const listed = [item('I_1', 'maddec01/lar-apple', 'In progress'), item('I_2', 'maddec01/lar-apple', 'Review')];
  const some: string[][] = [];
  const issues = Object.assign(countedSource('issues', () => listed), {
    seesEdits: true,
    readSome: async (items: Item[]) => { some.push(items.map((i) => i.id)); return items; },
  });
  const sources = mergeSources([], new Map([['maddec01/lar-apple', issues]]));
  await sources.read(undefined, pace(0));
  await sources.read(undefined, pace(15_000));
  assert.deepEqual(some, [['I_2']]);
});

test('a read that fails after a change check asks again for what it read, at the active pace', async () => {
  let fail = false;
  const some: string[][] = [];
  const issues = Object.assign(countedSource('issues', () => [item('I_1', 'maddec01/lar-apple', 'Queued')]), {
    seesEdits: true,
    readSome: async (items: Item[]) => { some.push(items.map((i) => i.id)); if (fail) throw new Error('timeout'); return items; },
    changes: async () => ['https://github.com/Maddec01/Lar-Apple/issues/1'],
  });
  const read = issues.read;
  issues.read = async () => { if (fail) throw new Error('timeout'); return read(); };
  const sources = mergeSources([], new Map([['maddec01/lar-apple', issues]]));
  await sources.read(undefined, pace(0));
  fail = true;
  await sources.probe(pace(5_000));
  assert.deepEqual(some, [], 'nothing read yet');
  await assert.rejects(sources.read(undefined, pace(5_000)), /timeout/);
  assert.deepEqual(some, [['I_1']], 'the URL matches whatever its case');
  fail = false;
  assert.equal(sources.due(pace(19_999)), false, 'a failed source waits out the active pace');
  await sources.read(undefined, pace(20_000));
  assert.equal(issues.reads, 2, 'the change the check found still reads');
});

test('a change check that fails waits a minute before it checks again', async () => {
  let checks = 0;
  const issues = Object.assign(countedSource('issues', () => []), { changes: async () => { checks++; throw new Error('HTTP 404'); } });
  const sources = mergeSources([], new Map([['maddec01/lar-apple', issues]]));
  await sources.read(undefined, pace(0));
  await sources.probe(pace(5_000));
  await sources.probe(pace(6_000));
  await sources.probe(pace(64_999));
  assert.equal(checks, 1);
  await sources.probe(pace(65_000));
  assert.equal(checks, 2);
});

test('an item read alone keeps the map its whole read gave it, as a dossier read alone has none', async () => {
  const map = { sections: [] } as unknown as NonNullable<Item['map']>;
  const project = Object.assign(countedSource('project', () => [{ ...item('I_1', 'maddec01/lar-apple', 'In progress'), map }]), {
    readSome: async (items: Item[]) => items.map(({ map: _, ...rest }) => rest),
  });
  const sources = merged(project);
  await sources.read(undefined, pace(0));
  const read = await sources.read(undefined, pace(15_000));
  assert.equal(read.items[0]!.map, map);
});

test("a read request naming an item no source lists reads only the source of the GitHub repository it names", async () => {
  const apple = countedSource('apple', () => []);
  const server = countedSource('server', () => []);
  const sources = mergeSources([], new Map([['maddec01/lar-apple', apple], ['maddec01/lar-server', server]]));
  await sources.read(undefined, pace(0));
  sources.invalidate('https://github.com/maddec01/Lar-Apple/issues/12');
  await sources.read(undefined, pace(2_000));
  assert.deepEqual([apple.reads, server.reads], [2, 1]);
  sources.invalidate('https://dev.azure.com/org/project/_workitems/edit/3');
  await sources.read(undefined, pace(4_000));
  assert.deepEqual([apple.reads, server.reads], [3, 2], 'any other URL reads every source');
});

test('a read of a few items keeps everything it brings, as a parent read with a new Task', async () => {
  const parent = item('I_1', 'maddec01/lar-apple', 'In progress');
  const task = (id: string, status: Status) => ({ ...item(id, 'maddec01/lar-apple', status), parent: { number: 1, title: 'p', url: parent.url!, repo: 'maddec01/lar-apple', state: 'open' as const } });
  const team = Object.assign(countedSource('team', () => [parent, task('I_2', 'Queued')]), {
    readSome: async () => [parent, task('I_2', 'Review'), task('I_3', 'List')],
  });
  const sources = merged(team);
  await sources.read(undefined, pace(0));
  const read = await sources.read(undefined, pace(15_000));
  assert.deepEqual(read.items.map((i) => `${i.id}:${i.status}`), ['I_1:In progress', 'I_2:Review', 'I_3:List']);
});

test('a change to a blocker reads the items it blocks too, and an unknown GitHub repository reads only the Projects', async () => {
  const blocked = { ...item('I_1', 'maddec01/lar-apple', 'Queued'), blockers: [{ number: 7, repo: 'maddec01/lar-server', state: 'open' as const }] };
  const some: string[][] = [];
  const project = Object.assign(countedSource('project', () => [blocked]), { readSome: async (items: Item[]) => { some.push(items.map((i) => i.id)); return items; } });
  const issues = countedSource('issues', () => []);
  const sources = mergeSources([project], new Map([['maddec01/lar-server', issues]]));
  await sources.read(undefined, pace(0));
  sources.invalidate('https://github.com/maddec01/lar-server/issues/7');
  await sources.read(undefined, pace(2_000));
  assert.deepEqual([some, issues.reads], [[['I_1']], 1]);
  sources.invalidate('https://github.com/someone/elsewhere/issues/1');
  await sources.read(undefined, pace(4_000));
  assert.deepEqual([project.reads, issues.reads], [2, 1]);
});
