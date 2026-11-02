import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { effectiveVocabulary, normalizeItems, type RepositorySetup, type VocabularyMapping } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { DEFAULT_RETENTION, openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { changeKind } from '@lar-factory/work-records/change-kind';
import { agreedKind, archivedItems, recordItems, ticketsByReference } from './record-items.ts';

const REPO = 'maddec01/lar-factory';
const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  for (const { records, dir } of opened.splice(0)) {
    records.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
async function open(): Promise<WorkRecords> {
  const dir = mkdtempSync(join(tmpdir(), 'record-items-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  return records;
}
const tickets = (...issues: Parameters<typeof boardIssue>[]) => normalizeItems(issues.map((args) => boardIssue(...args)));

test('recorded work keeps its progress and unpicked tracker issues appear fresh in List', async () => {
  const records = await open();
  const recorded = records.importTicket({ title: 'Recorded', repository: REPO, kind: 'feature', status: 'Queued', ticket: `${REPO}#12` }).record;
  records.create({ title: 'Elsewhere', repository: 'maddec01/other', kind: 'bug' });
  const items = recordItems(records, tickets([12, 'List'], [13, 'Shaping']), [REPO]);
  assert.deepEqual(items.map((i) => [i.id, i.number, i.status, i.kind, i.revision]), [[recorded.workId, 12, 'Queued', 'feature', recorded.revision], [items[1]!.id,13,'List','issue',0]]);
  assert.equal(items[0]!.url, `https://github.com/${REPO}/issues/12`);
});

test("a ticket edit never changes the record's Status, kind or title", async () => {
  const records = await open();
  records.importTicket({ title: 'Kept title', repository: REPO, kind: 'feature', status: 'Ready', ticket: `${REPO}#12` });
  const [item] = recordItems(records, tickets([12, 'Review', REPO, ['bug']]), [REPO]);
  assert.deepEqual([item!.status, item!.statuses, item!.kind, item!.title], ['Ready', ['Ready'], 'feature', 'Kept title']);
  assert.ok(item!.labels.includes('bug'), 'the ticket supplies its labels as context');
});

test("a recorded item takes its ticket's labels and colours from the read, and the record stores neither", async () => {
  const records = await open();
  const { record } = records.importTicket({ title: 'Coloured', repository: REPO, kind: 'feature', status: 'Queued', ticket: `${REPO}#12` });
  const [ticket] = tickets([12, 'Queued', REPO, ['area: web']]);
  const [item] = recordItems(records, [{ ...ticket!, labelColors: { 'area: web': '#BFDADC' } }], [REPO]);
  assert.deepEqual(item!.labelColors, { 'area: web': '#BFDADC' });
  assert.deepEqual(recordItems(records, [], [REPO]).find((i) => i.id === record.workId)!.labelColors, undefined);
  assert.equal(JSON.stringify(records.read(record.workId)).includes('BFDADC'), false);
});

test('a ticketless record and a record whose ticket the read did not list show from the record alone', async () => {
  const records = await open();
  const local = records.create({ title: 'Local', repository: REPO, kind: 'improvement', status: 'Shaping' });
  records.importTicket({ title: 'Unread', repository: REPO, kind: 'bug', ticket: `${REPO}#40` });
  const items = recordItems(records, [], [REPO]);
  assert.deepEqual(items.map((i) => [i.title, i.number, i.url, i.status, i.state]), [['Local', 0, null, 'Shaping', 'open'], ['Unread', 40, null, 'List', 'open']]);
  assert.equal(items[0]!.id, local.workId);
});

test('set-aside work and slices are no board items; a Done record is closed as done', async () => {
  const records = await open();
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Done' });
  const aside = records.create({ title: 'Aside', repository: REPO, kind: 'bug' });
  records.setAside(aside.workId, aside.revision);
  const slice = records.create({ title: 'Slice', repository: REPO, kind: 'slice' });
  records.setParent(slice.workId, slice.revision, build.workId);
  const items = recordItems(records, [], [REPO]);
  assert.deepEqual(items.map((i) => [i.title, i.state, i.closedAs]), [['Build', 'closed', 'done']]);
});

test('finished work retention hides leaves the board for Archive, and set-aside work is in Archive until Restore brings it back', async () => {
  const records = await open();
  const finished = records.create({ title: 'Finished', repository: REPO, kind: 'build', status: 'Done' });
  records.recordFinished(finished.workId, finished.revision);
  const aside = records.importTicket({ title: 'Aside', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  records.setAside(aside.workId, aside.revision);
  const read = tickets([12, 'List']);
  const week = new Set(records.hidden(DEFAULT_RETENTION).map((r) => r.workId));
  assert.deepEqual(recordItems(records, read, [REPO], [], week).map((i) => i.title), ['Finished'], 'finished work stays for seven days');
  const later = new Set(records.hidden(DEFAULT_RETENTION, new Date(Date.now() + 8 * 86_400_000)).map((r) => r.workId));
  assert.deepEqual(recordItems(records, read, [REPO], [], later), []);
  assert.deepEqual(archivedItems(records, read, [REPO], later).map((i) => [i.title, i.archived]), [
    ['Finished', { setAside: false, hidden: true, ticketOpen: false }],
    ['Aside', { setAside: true, hidden: true, ticketOpen: true }],
  ]);
  records.restore(aside.workId, records.read(aside.workId).revision);
  assert.deepEqual(recordItems(records, read, [REPO], [], new Set(records.hidden(DEFAULT_RETENTION).map((r) => r.workId))).map((i) => i.title), ['Finished', 'Aside']);
});

test("a record's structure, blockers and slices come from records", async () => {
  const records = await open();
  const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
  let build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'In progress' });
  build = records.setParent(build.workId, build.revision, concept.workId);
  const blocker = records.importTicket({ title: 'Blocker', repository: REPO, kind: 'decision', ticket: `${REPO}#5` }).record;
  build = records.addBlocker(build.workId, build.revision, blocker.workId);
  const slice = records.create({ title: 'First slice', repository: REPO, kind: 'slice', status: 'In progress' });
  records.setParent(slice.workId, slice.revision, build.workId);
  records.setBody(concept.workId, records.read(concept.workId).revision, 'map', '## Destination\n\nWhere it goes.\n\n## Fog\n\n- What is left\n');
  const items = recordItems(records, [], [REPO]);
  const shown = (title: string) => items.find((i) => i.title === title)!;
  assert.equal(shown('Build').parentId, concept.workId);
  assert.deepEqual(shown('Build').parent && [shown('Build').parent!.title, shown('Build').parent!.number], ['Concept', 0]);
  assert.deepEqual(shown('Build').blockers, [{ number: 5, repo: REPO, state: 'open', workId: blocker.workId, title: 'Blocker' }]);
  assert.deepEqual(shown('Build').slices.map((s) => [s.title, s.progress]), [['First slice', 'waiting']]);
  assert.deepEqual(shown('Concept').subIssues, { total: 1, completed: 0 });
  assert.deepEqual(shown('Concept').map, { destination: 'Where it goes.', decisions: [], fog: ['What is left'] });
});

test("only the record's blockers hold it: its ticket's provider blockers never do", async () => {
  const records = await open();
  records.importTicket({ title: 'Ticketed', repository: REPO, kind: 'feature', status: 'Queued', ticket: `${REPO}#12` });
  const [ticket] = tickets([12, 'Queued']);
  const [item] = recordItems(records, [{ ...ticket!, blockers: [{ number: 11, repo: REPO, state: 'open' }] }], [REPO]);
  assert.deepEqual(item!.blockers, []);
});

test('a Dependency blocking a build is one of its blockers, open until the user marks it met, whatever its ticket shows', async () => {
  const records = await open();
  const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Ready' });
  records.setParent(build.workId, build.revision, concept.workId);
  let dependency = records.addDependency(concept.workId, { need: 'An export endpoint', owner: 'server team', evidence: 'It answers in staging',
    ticket: 'maddec01/lar-server#40', pullRequests: ['maddec01/lar-server#41'] });
  dependency = records.addDependencyBlock(dependency.dependencyId, dependency.revision, build.workId);
  dependency = records.observeDependency(dependency.dependencyId, dependency.revision, { subject: 'maddec01/lar-server#41', kind: 'open' });
  dependency = records.observeDependency(dependency.dependencyId, dependency.revision, { subject: 'maddec01/lar-server#40', kind: 'closed' });
  const shown = () => recordItems(records, [], [REPO]).find((i) => i.id === build.workId)!.blockers;
  const [blocker] = shown();
  assert.deepEqual({ ...blocker, dependency: { ...blocker!.dependency, observation: { ...blocker!.dependency!.observation, observedAt: '' } } }, {
    number: 40, repo: 'maddec01/lar-server', state: 'open', title: 'An export endpoint', dependency: {
      dependencyId: dependency.dependencyId, revision: dependency.revision, owner: 'server team', need: 'An export endpoint',
      ticket: 'maddec01/lar-server#40', named: [{ reference: 'maddec01/lar-server#40', url: 'https://github.com/maddec01/lar-server/issues/40' },
        { reference: 'maddec01/lar-server#41', url: 'https://github.com/maddec01/lar-server/pull/41' }],
      evidence: 'It answers in staging', met: null, needsReview: false,
      observation: { subject: 'maddec01/lar-server#40', kind: 'closed', detail: null, observedAt: '', lastGood: null } } });
  dependency = records.markDependencyMet(dependency.dependencyId, dependency.revision, 'pedro');
  assert.deepEqual(shown().map((b) => [b.state, b.dependency!.met?.by]), [['closed', 'pedro']]);
  records.observeDependency(dependency.dependencyId, dependency.revision, { subject: 'maddec01/lar-server#40', kind: 'reopened' });
  assert.deepEqual(shown().map((b) => [b.state, b.dependency!.needsReview]), [['closed', true]], 'a changed observation asks for a review and keeps the mark');
});

test("a Dependency's Azure work item and PR link to their pages", async () => {
  const records = await open();
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Ready' });
  const API = 'contoso/Fabrikam%20Fiber/Web%20Api';
  const dependency = records.addDependency(build.workId, { need: 'An export endpoint', owner: API, ticket: `${API}#5`, pullRequests: [`${API}#9`] });
  records.addDependencyBlock(dependency.dependencyId, dependency.revision, build.workId);
  const [blocker] = recordItems(records, [], [REPO]).find((i) => i.id === build.workId)!.blockers;
  assert.deepEqual(blocker!.dependency!.named, [
    { reference: `${API}#5`, url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/5' },
    { reference: `${API}#9`, url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/Web%20Api/pullrequest/9' },
  ]);
});

test("in a repository whose source hasn't read yet, only a record with a ticket waits for it", async () => {
  const records = await open();
  records.importTicket({ title: 'Unread', repository: REPO, kind: 'bug', ticket: `${REPO}#40` });
  records.create({ title: 'Local', repository: REPO, kind: 'feature' });
  assert.deepEqual(recordItems(records, [], [REPO], [REPO]).map((i) => i.title), ['Local']);
  assert.deepEqual(recordItems(records, tickets([40, 'List']), [REPO], [REPO]).map((i) => i.title), ['Unread', 'Local']);
});

test('work that needs you shows the reason, with what its PR and ticket observations offer', async () => {
  const records = await open();
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Review' });
  let record = records.setPullRequest(build.workId, build.revision, `${REPO}#40`);
  record = records.observe(build.workId, record.revision, { of: 'pr', state: 'closed' });
  records.setNeedsYou(build.workId, record.revision, 'Its PR closed without merging.');
  const closed = records.importTicket({ title: 'Closed', repository: REPO, kind: 'bug', status: 'Queued', ticket: `${REPO}#12` }).record;
  records.setNeedsYou(closed.workId, records.observe(closed.workId, closed.revision, { of: 'ticket', state: 'closed' }).revision, 'Its ticket closed.');
  const reopened = records.importTicket({ title: 'Reopened', repository: REPO, kind: 'bug', status: 'Done', ticket: `${REPO}#13` }).record;
  records.setNeedsYou(reopened.workId, records.observe(reopened.workId, reopened.revision, { of: 'ticket', state: 'open' }).revision, 'Its ticket reopened.');
  const calm = records.create({ title: 'Calm', repository: REPO, kind: 'bug' });
  const shown = new Map(recordItems(records, [], [REPO]).map((item) => [item.id, item.needsYou]));
  assert.deepEqual(shown.get(build.workId), { reason: 'Its PR closed without merging.', offers: ['reopen-pr', 'replace-pr', 'set-aside'] });
  assert.deepEqual(shown.get(closed.workId), { reason: 'Its ticket closed.', offers: ['set-aside'] });
  assert.deepEqual(shown.get(reopened.workId), { reason: 'Its ticket reopened.', offers: ['reopen-work'] });
  assert.equal(shown.get(calm.workId), undefined);
});

test('concept counts completed decision facts while its Status remains Shaping, and recovered structure starts with no local completion', async () => {
  const records=await open();const concept=records.create({repository:REPO,kind:'concept',title:'Naming concept',status:'Shaping'});
  let first=records.create({repository:REPO,kind:'decision',title:'Choose the name',status:'Shaping'});
  first=records.setParent(first.workId,first.revision,concept.workId);
  let second=records.create({repository:REPO,kind:'decision',title:'Choose the visibility',status:'Shaping'});
  second=records.setParent(second.workId,second.revision,concept.workId);
  first=records.setBody(first.workId,first.revision,'answer','Use the native issue title.');
  first=records.setBody(first.workId,first.revision,'domain-drafts','none');
  records.setBody(concept.workId,records.read(concept.workId).revision,'map','## Destination\nClear names.\n\n## Decisions so far\n- Use the native issue title.\n\n## Fog\n- Visibility remains open.\n');
  let ready=records.create({repository:REPO,kind:'build',title:'Ready work',status:'Ready'});
  ready=records.setBody(ready.workId,ready.revision,'brief','A private passing brief.');
  records.recordGate(ready.workId,ready.revision,{briefDigest:records.gate(ready.workId).briefDigest!,approvedBy:'reviewer',evidence:'Checks passed.'});
  assert.deepEqual(records.completion(first.workId),{complete:true,reasons:[]});
  const items=recordItems(records,[],[REPO]);const shown=(id:string)=>items.find(item=>item.id===id)!;
  assert.deepEqual(shown(concept.workId).subIssues,{total:2,completed:1});
  assert.deepEqual([shown(first.workId).kind,shown(first.workId).status,shown(first.workId).labels,shown(first.workId).completion],['decision','Shaping',[],{complete:true,reasons:[]}]);
  assert.equal(shown(second.workId).completion?.complete,false);
  assert.deepEqual([shown(ready.workId).status,shown(ready.workId).completion?.complete,records.gate(ready.workId).current],['Ready',false,true]);
  const snapshot=records.trackerSnapshot(concept.workId);const encoded=JSON.stringify(snapshot);
  for(const localOnly of ['"completion":','"status":','"answer":','"domain-drafts":','A private passing brief.'])assert.ok(!encoded.includes(localOnly));
  const fresh=await open();const restored=fresh.trackerRestore(snapshot,'a'.repeat(64));const recovered=recordItems(fresh,[],[REPO]);
  assert.deepEqual(recovered.find(item=>item.id===restored)!.subIssues,{total:2,completed:0});
  assert.ok(recovered.every(item=>item.status==='List'&&item.completion?.complete===false));
  assert.deepEqual(recovered.find(item=>item.id===restored)!.map?.decisions,['Use the native issue title.']);
});

const SWAPS: [string, VocabularyMapping, string[]][] = [
  ['a mapping', { bug: { type: null, labels: ['type: bug'] }, feature: { type: null, labels: ['type: feature'] } }, ['type: bug', 'docs']],
  ['no mapping', {}, ['bug', 'docs']],
];
for (const [name, vocabulary, labels] of SWAPS) test(`a board read after a kind swap keeps the new kind, with ${name}`, async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'Swapped', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  let onTicket: string[] = [...labels];
  const setup = { repo: REPO, access: { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' }, vocabulary: effectiveVocabulary(vocabulary).vocabulary } as unknown as RepositorySetup;
  const { error } = await changeKind(records, workId, revision, 'feature', { setup,
    labels: { addToTicket: async (_, names) => { onTicket.push(...names); }, removeFromTicket: async (_, names) => { onTicket = onTicket.filter((label) => !names.includes(label)); } },
    kinds: { read: async () => ({ labels: onTicket, type: null }), setType: async () => {}, boardTypes: async () => null } });
  assert.equal(error, null);
  const [item] = recordItems(records, tickets([12, 'List', REPO, onTicket]), [REPO]);
  assert.equal(item!.kind, 'feature');
  assert.deepEqual(item!.labels.filter((label) => label !== 'status-list'), Object.keys(vocabulary).length ? ['docs', 'type: feature'] : ['docs']);
});

test('a board read keeps the kind even when the swap could not write, as the ticket still says the old one', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'Local', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const setup = { repo: REPO, access: { 'tag-ticket': 'refused' }, vocabulary: effectiveVocabulary({}).vocabulary } as unknown as RepositorySetup;
  await changeKind(records, workId, revision, 'feature', { setup, labels: { addToTicket: async () => {}, removeFromTicket: async () => {} },
    kinds: { read: async () => ({ labels: ['bug'], type: null }), setType: async () => {}, boardTypes: async () => null } });
  const [item] = recordItems(records, tickets([12, 'List', REPO, ['bug']]), [REPO]);
  assert.equal(item!.kind, 'feature');
});

const setupWith = (vocabulary: VocabularyMapping = {}) => ({ repo: REPO, access: {}, vocabulary: effectiveVocabulary(vocabulary).vocabulary }) as unknown as RepositorySetup;
const MAPPED: VocabularyMapping = { bug: { type: null, labels: ['type: bug'] }, feature: { type: null, labels: ['type: feature'] } };
const importBug = (records: WorkRecords, kind: 'bug' | 'feature' | 'improvement' | 'concept' = 'bug') => records.importTicket({ title: 'T', repository: REPO, kind, ticket: `${REPO}#12` }).record;
const readWith = (records: WorkRecords, labels: string[], vocabulary?: VocabularyMapping) => recordItems(records, tickets([12, 'List', REPO, labels]), [REPO], [], new Set(), [setupWith(vocabulary)])[0]!;

test('a board read shows how the item\'s kind and its ticket\'s disagree, and an item that agrees has no disagreement', async () => {
  const records = await open();
  importBug(records);
  assert.deepEqual(readWith(records, ['feature']).kindDisagreement, { ticketKind: 'feature', changed: 'item', kept: false, swap: { add: [], remove: ['feature'], type: null } });
  assert.equal(readWith(records, ['bug']).kindDisagreement, undefined);
  assert.equal(readWith(records, ['feature', 'type: bug'], MAPPED).kindDisagreement, undefined);
});

test('a GitHub issue\'s type and an Azure work item\'s type both count', async () => {
  const records = await open();
  importBug(records);
  const [ticket] = tickets([12, 'List', REPO, []]);
  const read = (more: Partial<typeof ticket & object>) => recordItems(records, [{ ...ticket!, ...more }], [REPO], [], new Set(), [setupWith()])[0]!.kindDisagreement?.ticketKind;
  assert.equal(read({ issueType: 'Feature' }), 'feature');
  assert.equal(read({ azure: { type: 'User Story', state: 'New' } as NonNullable<typeof ticket & object>['azure'] }), 'feature');
});

test('a read with no ticket, or a repository with no setup, shows no disagreement', async () => {
  const records = await open();
  importBug(records);
  assert.equal(recordItems(records, [], [REPO], [], new Set(), [setupWith(MAPPED)])[0]!.kindDisagreement, undefined);
  assert.equal(recordItems(records, tickets([12, 'List', REPO, ['feature']]), [REPO])[0]!.kindDisagreement, undefined);
});

test('concepts and local work never disagree', async () => {
  const records = await open();
  importBug(records, 'concept');
  records.create({ title: 'Local', repository: REPO, kind: 'bug' });
  const items = recordItems(records, tickets([12, 'List', REPO, ['bug']]), [REPO], [], new Set(), [setupWith(MAPPED)]);
  assert.deepEqual(items.map((item) => item.kindDisagreement), [undefined, undefined]);
});

test('a kept answer shows as kept until the ticket\'s kind changes', async () => {
  const records = await open();
  const { workId, revision } = importBug(records);
  records.recordKindAnswer(workId, revision, { answer: 'keep', ticketKind: 'feature' });
  assert.equal(readWith(records, ['feature']).kindDisagreement?.kept, true);
  assert.equal(readWith(records, ['improvement']).kindDisagreement?.kept, false);
});

for (const [name, vocabulary, labels] of SWAPS) test(`no disagreement shows on the board read after a swap, with ${name}`, async () => {
  const records = await open();
  const { workId, revision } = importBug(records);
  let onTicket = [...labels];
  const setup = { ...setupWith(vocabulary), access: { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' } } as RepositorySetup;
  assert.ok(readWith(records, ['feature'], vocabulary).kindDisagreement);
  await changeKind(records, workId, revision, 'feature', { setup,
    labels: { addToTicket: async (_, names) => { onTicket.push(...names); }, removeFromTicket: async (_, names) => { onTicket = onTicket.filter((label) => !names.includes(label)); } },
    kinds: { read: async () => ({ labels: onTicket, type: null }), setType: async () => {}, boardTypes: async () => null } });
  assert.equal(readWith(records, onTicket, vocabulary).kindDisagreement, undefined);
});

test('the kind a record and its ticket agree on comes from the last read and the mappings', async () => {
  const records = await open();
  const record = importBug(records);
  const byTicket = (labels: string[]) => ticketsByReference(tickets([12, 'List', REPO, labels]));
  const { vocabulary } = setupWith(MAPPED);
  assert.equal(agreedKind(record, byTicket(['feature', 'type: bug']), vocabulary), 'bug');
  assert.equal(agreedKind(record, byTicket(['feature']), vocabulary), null);
  assert.equal(agreedKind(record, new Map(), vocabulary), null);
  assert.equal(agreedKind(record, byTicket(['bug']), undefined), null);
});
