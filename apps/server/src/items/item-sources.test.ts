import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item, ItemSourceKind, Status } from '@lar-factory/shared';
import { ReadProblem, type ItemSource, type ItemsRead } from './item-source.ts';
import type { RepositoryConfig } from '../config/repository-config.ts';
import { fakeAz } from '../azure/fake-az.ts';
import { configuredSources, mergeSources, onboardedSources } from './item-sources.ts';

const item = (id: string, repo: string, status: Status = 'List'): Item => ({
  id, status, statuses: [status], content: 'ticket', revision: 0, kind: 'issue', parentId: null, number: Number(id.slice(2)), title: id, url: `https://github.com/${repo}/issues/${id.slice(2)}`, repo,
  labels: [], state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
  updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
});

/** One shared source serving two onboarded repositories. */
const merged = (source: ItemSource) => mergeSources(new Map([['maddec01/lar-server', source], ['maddec01/lar-apple', source]]));

/** A source that lists `items` and records each write it is asked for. */
function fakeSource(title: string, items: Item[], writes: string[]): ItemSource {
  const write = (what: string) => async () => { writes.push(`${title} ${what}`); return null; };
  return {
    read: async () => ({ title, items }),
    searchTickets: async (repo, query) => { writes.push(`${title} search ${repo} ${query}`); return []; },
    readTicket: async (repo, number) => { writes.push(`${title} read ${repo}#${number}`); return null; },
    observeTicket: async (repo, number) => { writes.push(`${title} observe ${repo}#${number}`); return { state: 'open' }; },
    abandon: async (i) => write(`abandon ${i.id}`)(),
  };
}

test("a ticket search, read and observation go to the repository's own source, and an unlisted repository's refuse", async () => {
  const writes: string[] = [];
  const source = mergeSources(new Map([['maddec01/lar-server', fakeSource('lar', [], writes)], ['maddec01/lar-apple', fakeSource('apple', [], writes)]]));
  await source.searchTickets('maddec01/lar-apple', 'seek');
  await source.readTicket('Maddec01/Lar-Server', 7);
  await source.observeTicket('maddec01/lar-apple', 8);
  assert.deepEqual(writes, ['apple search maddec01/lar-apple seek', 'lar read Maddec01/Lar-Server#7', 'apple observe maddec01/lar-apple#8']);
  await assert.rejects(source.searchTickets('maddec01/other', 'seek'), /isn't onboarded/);
  await assert.rejects(source.observeTicket('maddec01/other', 8), /isn't onboarded/);
});

test('a merged source lists every item it read, with or without a status', async () => {
  const project = fakeSource('lar', [{ ...item('I_1', 'maddec01/lar-server'), statuses: [] }], []);
  const issues = fakeSource('apple', [{ ...item('I_2', 'maddec01/lar-apple'), statuses: [] }], []);
  const read = await mergeSources(new Map([['maddec01/lar-server', project], ['maddec01/lar-apple', issues]])).read();
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_2']);
});

test('with no source a read lists nothing and an abandon is refused', async () => {
  const sources = mergeSources(new Map());
  assert.deepEqual(await sources.read(), { title: '', items: [] });
  assert.equal(await sources.abandon(item('I_1', 'maddec01/lar-server')), "That item's repository isn't onboarded.");
});

const config = (repo: string, show: RepositoryConfig['show'] = 'all'): RepositoryConfig =>
  ({ repo, version: 1, role: 'role', itemSource: { kind: 'issues' }, show, labels: [] });

test('each read loads the configs first and builds the sources again only when they changed', async () => {
  let configs = [config('maddec01/lar-apple')];
  const built: string[][] = [];
  const sources = onboardedSources(async () => ({ configs, problems: [] }), (read) => {
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

test("a read whose configs can't be loaded fails, and abandons keep going to the last sources", async () => {
  const writes: string[] = [];
  let fail = false;
  const sources = onboardedSources(async () => {
    if (fail) throw new Error('repository-settings.json isn\'t valid JSON.');
    return { configs: [config('maddec01/lar-apple')], problems: [] };
  }, () => merged(fakeSource('apple', [], writes)));
  await sources.read();
  fail = true;
  await assert.rejects(sources.read(), /valid JSON/);
  await sources.abandon(item('I_1', 'maddec01/lar-apple'));
  assert.deepEqual(writes, ['apple abandon I_1']);
  assert.equal(sources.repos().length, 1);
});

test("a read leaves out the items of a repository whose config couldn't be read, though a shared source lists them", async () => {
  const listed = [item('I_1', 'maddec01/lar-server'), item('I_2', 'maddec01/lar-apple'), item('I_3', 'maddec01/LAR-APPLE')];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-server')],
    problems: [{ repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' }] }), () => merged(fakeSource('lar', listed, [])));
  assert.deepEqual((await sources.read()).items.map((i) => i.id), ['I_1']);
});

const azure = (repo: string, team = 'Fabrikam Team', show: RepositoryConfig['show'] = 'all'): RepositoryConfig =>
  ({ repo, version: 1, role: 'role', itemSource: { kind: 'azure-board', team }, show, labels: [] });

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

test('a problem with a source that repositories share shows under each of them', async () => {
  const sprint: ItemSource = { ...fakeSource('sprint', [], []), read: async () => { throw new ReadProblem('az is logged out.', 'az login'); } };
  const read = await mergeSources(new Map([['contoso/p/web', sprint], ['contoso/p/api', sprint]])).read();
  assert.deepEqual(read.problems, [{ repo: 'contoso/p/web', problem: 'az is logged out.', fix: 'az login' }, { repo: 'contoso/p/api', problem: 'az is logged out.', fix: 'az login' }]);
});

/** A source whose read finishes when `finish` is called. */
function slowSource(name: string, items: Item[] = []): { source: ItemSource; finish: () => void } {
  let finish = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  return { source: { ...fakeSource(name, [], []), name, read: async () => { await done; return { title: name, items }; } }, finish };
}

test('a read marks each source as started at once and as finished when its own read ends, without waiting for the others', async () => {
  const fast = slowSource('lar-apple');
  const slow = slowSource('lar-server');
  const events: string[] = [];
  const progress = { started: (name: string) => events.push(`+${name}`), finished: (name: string) => events.push(`-${name}`) };
  const read = mergeSources(new Map([['maddec01/lar-server', slow.source], ['maddec01/lar-apple', fast.source]])).read(progress);
  assert.deepEqual(events, ['+lar-server', '+lar-apple']);
  fast.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.slice(2), ['-lar-apple'], 'the fast read reports before the slow one ends');
  slow.finish();
  await read;
  assert.deepEqual(events.slice(3), ['-lar-server']);
});

test("a source without a name is named by its repositories, and a failed read still finishes", async () => {
  const events: string[] = [];
  const progress = { started: (name: string) => events.push(`+${name}`), finished: (name: string) => events.push(`-${name}`) };
  const failing: ItemSource = { ...fakeSource('x', [], []), read: async () => { throw new Error('boom'); } };
  const sources = mergeSources(new Map([['contoso/p%20q/web', failing], ['contoso/p%20q/api', failing]]));
  await assert.rejects(sources.read(progress), /boom/);
  assert.deepEqual(events, ['+web, api', '-web, api']);
});

test("each source's read lands while another still reads, with the items read so far and the repositories still waiting", async () => {
  const fast = slowSource('lar-apple', [item('I_2', 'maddec01/lar-apple')]);
  const slow = slowSource('lar', [item('I_1', 'maddec01/lar-server')]);
  const landed: ItemsRead[] = [];
  const progress = { started: () => {}, finished: () => {}, landed: (read: ItemsRead) => landed.push(read) };
  const reading = mergeSources(new Map([['maddec01/lar-server', slow.source], ['maddec01/lar-apple', fast.source]])).read(progress);
  fast.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(landed.map((read) => [read.items.map((i) => i.id), read.waiting]), [[['I_2'], ['maddec01/lar-server']]]);
  slow.finish();
  const read = await reading;
  assert.equal(landed.length, 1, 'the last read to land is the read itself');
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_2']);
  assert.equal(read.waiting, undefined);
});

test("a source whose first read failed, or that its tool blocks, isn't waiting, as neither is about to read", async () => {
  const failing: ItemSource = { ...fakeSource('lar-docs', [], []), read: async () => { throw new Error('boom'); } };
  const slow = slowSource('lar-apple', [item('I_2', 'maddec01/lar-apple')]);
  const slower = slowSource('lar-web');
  const blocked = countedSource('lar', () => []);
  const landed: ItemsRead[] = [];
  const progress = { started: () => {}, finished: () => {}, landed: (read: ItemsRead) => landed.push(read) };
  const sources = mergeSources(new Map([['maddec01/lar-server', blocked], ['maddec01/lar-docs', failing], ['maddec01/lar-apple', slow.source],
    ['maddec01/lar-web', slower.source]]), new Map<ItemSource, ItemSourceKind>([[blocked, 'azure-board'], [failing, 'issues'], [slow.source, 'issues'], [slower.source, 'issues']]));
  const held = { ...pace(0), waits: (kind: string) => kind === 'azure-board', blocked: (kind: string) => kind === 'azure-board' };
  const reading = sources.read(progress, held);
  await new Promise((resolve) => setImmediate(resolve));
  slow.finish();
  await new Promise((resolve) => setImmediate(resolve));
  slower.finish();
  await assert.rejects(reading, /boom/);
  assert.deepEqual(landed.map((read) => read.waiting), [['maddec01/lar-web']], 'neither the failed nor the blocked source waits');
  assert.equal(blocked.reads, 0);
  const checking = await sources.read(undefined, { ...pace(1_000), waits: (kind: string) => kind === 'azure-board' });
  assert.deepEqual(checking.waiting, ['maddec01/lar-server'], "a source waiting for its tool's check is waiting");
});

test('the onboarded sources pass on what has landed, leaving out the repositories they leave out', async () => {
  const listed = [item('I_1', 'maddec01/lar-server'), item('I_2', 'maddec01/lar-apple')];
  const landed: ItemsRead[] = [];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-server')], problems: [{ repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' }] }),
    () => ({ ...merged(fakeSource('lar', [], [])), read: async (progress) => {
      progress?.landed?.({ title: 'lar', items: listed, waiting: ['maddec01/lar-factory'] });
      return { title: 'lar', items: listed };
    } }));
  await sources.read({ started: () => {}, finished: () => {}, landed: (read) => landed.push(read) });
  assert.deepEqual(landed.map((read) => [read.items.map((i) => i.id), read.waiting]), [[['I_1'], ['maddec01/lar-factory']]]);
});

test('the onboarded sources pass the progress to the sources they build', async () => {
  const events: string[] = [];
  const sources = onboardedSources(async () => ({ configs: [config('maddec01/lar-apple')], problems: [] }),
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', busy], ['maddec01/lar-server', idle]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', apple], ['maddec01/lar-server', server]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', good], ['maddec01/lar-server', flaky]]));
  await assert.rejects(sources.read(undefined, pace(0)), /boom/);
  fail = false;
  assert.equal(sources.due(pace(14_999)), false, 'a source that never read retries at the active pace');
  const read = await sources.read(undefined, pace(15_000));
  assert.deepEqual(read.items.map((i) => i.id), ['I_1', 'I_2']);
  assert.deepEqual([good.reads, flaky.reads], [1, 2]);
});

test('a paced read loads the configs again only every 5 minutes, or after reload', async () => {
  let loads = 0;
  const sources = onboardedSources(async () => { loads++; return { configs: [config('maddec01/lar-apple')], problems: [] }; },
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
  const sources = mergeSources(new Map([['maddec01/lar-server', project]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-server', project]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-server', project]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', issues]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', issues]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', issues]]));
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
  const sources = mergeSources(new Map([['maddec01/lar-apple', apple], ['maddec01/lar-server', server]]));
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

test('a source whose kind waits reads nothing and checks for no changes, and reads whole once it stops waiting', async () => {
  const checks: number[] = [];
  const github = Object.assign(countedSource('github', () => [item('I_1', 'maddec01/lar-apple')]), { changes: async (since: number) => { checks.push(since); return []; } });
  const azure = countedSource('azure', () => [item('I_2', 'maddec01/lar-server')]);
  const sources = mergeSources(new Map([['maddec01/lar-apple', github], ['maddec01/lar-server', azure]]),
    new Map([[github, 'issues'], [azure, 'azure-board']]));
  let waiting = new Set<string>(['azure-board']);
  const paced = (now: number) => ({ ...pace(now), waits: (kind: string) => waiting.has(kind) });
  assert.deepEqual((await sources.read(undefined, { ...paced(0), waits: () => true })).waiting, ['maddec01/lar-apple', 'maddec01/lar-server'],
    'a read with every source waiting reads nothing, and every repository waits');
  const read = await sources.read(undefined, paced(0));
  assert.deepEqual(read.items.map((i) => i.id), ['I_1']);
  assert.deepEqual(read.waiting, ['maddec01/lar-server'], 'the waiting source\'s repository is still waiting');
  assert.deepEqual([github.reads, azure.reads], [1, 0]);
  waiting = new Set(['issues']);
  await sources.probe(paced(5_000));
  assert.deepEqual(checks, [], 'a waiting source checks for no changes');
  assert.equal(sources.due(paced(5_000)), true, 'the source that stopped waiting is due at once');
  assert.deepEqual((await sources.read(undefined, paced(5_000))).items.map((i) => i.id), ['I_1', 'I_2'], 'a waiting source lists its last read');
  assert.deepEqual([github.reads, azure.reads], [1, 1]);
});


test('repositories reading one Azure board share its backlog and sprint and route tagged items', async () => {
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }, { id: 2, type: 'User Story', state: 'Active', tags: 'repo-api' }], backlog: [1, 2], sprint: [2] });
  const configs = [azure('contoso/Fabrikam/web'), azure('Contoso/fabrikam/api', 'fabrikam team')]
    .map((config) => ({ ...config, itemSource: { kind: 'azure-board' as const, team: config.itemSource.kind === 'azure-board' ? config.itemSource.team : '' } }));
  const read = await configuredSources(configs, az.run).read();
  assert.deepEqual(read.items.map((i) => [i.number, i.repo, i.untaggedFor ?? null]), [
    [1, 'contoso/Fabrikam/web', ['contoso/Fabrikam/web', 'Contoso/fabrikam/api']], [2, 'Contoso/fabrikam/api', null],
  ]);
  assert.equal(az.calls.filter((c) => c[3] === 'list-work-items').length, 1);
  assert.equal(az.calls.filter((c) => c.includes('backlogs') && c.includes('id=Microsoft.RequirementCategory/workItems')).length, 1);
});
