import { afterEach, expect, test } from 'vite-plus/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoConfig, TicketCreationOptions, TrackerLabels } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from './work-records.ts';
import { captureWork, createRecordTicket, recordTicketPreview } from './create-ticket.ts';
import type { StructureProvider, StructureTicket } from './tracker-sync.ts';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const REPO = 'example/product';
const opened: { dir: string; records: WorkRecords }[] = [];
afterEach(() => { for (const { dir, records } of opened.splice(0)) { records.close(); rmSync(dir, { recursive: true, force: true }); } });
const options: TicketCreationOptions = { provider: 'github', labels: ['bug'], types: ['Bug'], assignees: ['person'], milestones: [{ value: '1', name: 'Next' }], iterations: [], problems: [] };
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'convert-ticket-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ dir, records });
  const local = records.create({ repository: REPO, kind: 'bug', title: 'Fix export', context: 'Original request.' });
  const repo = { repo: REPO, labels: [], role: '', setup: { repo: REPO, access: { 'publish-ticket': 'allowed', 'edit-ticket': 'allowed', 'tag-ticket': 'allowed', 'type-ticket': 'allowed' }, vocabulary: { bug: { labels: ['bug'], type: 'Bug' } } } } as unknown as RepoConfig;
  const writes: unknown[][] = [];
  const provider = { create: async (...args: unknown[]) => { writes.push(args); return { repository: args[0], title: args[1], body: args[2], number: 13, version: '1' }; } } as unknown as StructureProvider;
  const deps = { records, repos: () => [repo], provider, discoverOptions: async () => options };
  const convert = (extra: Record<string, unknown> = {}) => createRecordTicket(local.workId, { requestId: REQUEST, revision: records.read(local.workId).revision, ...extra }, deps);
  return { records, local, repo, writes, deps, convert };
}

test('conversion sends only the current passing brief as Spec when enabled, with description as Original', async () => {
  const { records, local, repo, convert, writes } = await setup();
  let record = records.setBody(local.workId, local.revision, 'brief', '## What\nFix export.');
  expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Original request.');
  records.recordGate(record.workId, record.revision, { briefDigest: records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'passed' });
  expect(recordTicketPreview(records, local.workId, [repo]).description).toContain('<summary>Original</summary>');
  repo.setup!.writeRefinedSpec = false;
  expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Original request.');
  repo.setup!.writeRefinedSpec = true;
  record = records.read(local.workId);
  records.setBody(local.workId, record.revision, 'brief', '## What\nA changed brief.');
  expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Original request.');
  record = records.read(local.workId);
  records.recordGate(record.workId, record.revision, { briefDigest: records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'passed again' });
  expect((await convert()).status).toBe(200);
  expect(String(writes[0]![2])).toMatch(/A changed brief\.[\s\S]*Original request\./);
  expect(records.initialContext(local.workId)).toBe('Original request.');
  expect((await convert()).body.record?.workId).toBe(local.workId);
  expect(writes).toHaveLength(1);
});

test('retro honors its own setting and maps only kind labels and type', async () => {
  const { repo, records, local, convert, writes } = await setup();
  repo.setup!.createIssuesFromRetro = false;
  expect((await convert({ retro: true })).body.record?.ticket).toBeNull();
  expect(writes).toHaveLength(0);
  repo.setup!.createIssuesFromRetro = true;
  expect((await convert({ retro: true, options: { assignee: 'person', milestone: '1' } })).status).toBe(200);
  expect(writes[0]![5]).toEqual({ labels: ['bug'], type: 'Bug' });
  expect(String(writes[0]![2])).toMatch(/^Original request\.\n\n<!-- lar-factory:create /);
  expect(String(writes[0]![2])).not.toContain(local.workId);
  expect(records.list({})).toHaveLength(1);
});

test('refused creation leaves the work local, reports failure and permits a new submission', async () => {
  const { repo, records, local, convert, writes } = await setup();
  repo.setup!.access['publish-ticket'] = 'refused';
  expect((await convert({ retro: true })).body.error).toMatch(/refused/i);
  expect(records.read(local.workId).ticket).toBeNull();
  expect(writes).toHaveLength(0);
  repo.setup!.access['publish-ticket'] = 'allowed';
  expect((await convert({ requestId: SECOND })).status).toBe(200);
});

test('an uncertain conversion survives reopening the database and blocks a second submission', async () => {
  const { records, local, deps, convert } = await setup();
  let ticket: StructureTicket | undefined;
  let writes = 0;
  deps.provider.create = async (repository, title, body) => { writes++; ticket = { repository, title, body, number: 14, version: '1' }; throw Error('Response lost'); };
  deps.provider.find = async () => ticket ? [ticket] : [];
  expect((await convert()).body.uncertain).toBe(true);
  expect((await convert({ requestId: SECOND })).body.error).toMatch(/already has a ticket creation submission/);
  expect(records.read(local.workId).ticket).toBeNull();
  const handle = opened[0]!;
  records.close();
  handle.records = await openWorkRecords(join(handle.dir, 'work-records.db'));
  deps.records = handle.records;
  const recovered = await createRecordTicket(local.workId, { requestId: REQUEST, revision: local.revision }, deps);
  expect(recovered.body.record).toMatchObject({ workId: local.workId, ticket: `${REPO}#14` });
  expect(writes).toBe(1);
});

test('conversion ignores client text, validates options and refuses stale previews before creating', async () => {
  const { convert, local, writes } = await setup();
  expect((await convert({ revision: local.revision + 1 })).status).toBe(409);
  expect((await convert({ options: { unexpected: 'x' } })).status).toBe(422);
  expect((await convert({ draft: { title: 'Injected' }, title: 'Injected', description: 'Injected', options: { labels: ['bug'], type: 'Bug', assignee: 'person', milestone: '1' } })).status).toBe(200);
  expect(writes).toHaveLength(1);
  expect(writes[0]![1]).toBe('Fix export');
  expect(writes[0]![5]).toEqual({ labels: ['bug'], type: 'Bug', assignee: 'person', milestone: '1' });
});

test('a local build can convert after shaping without changing its kind or passing brief', async () => {
  const { records, local, convert, writes } = await setup();
  const record = records.update(local.workId, local.revision, { kind: 'build', status: 'Ready' });
  records.setBody(local.workId, record.revision, 'brief', 'Build scope.');
  const result = await convert();
  expect(result.status).toBe(200);
  expect(result.body.record).toMatchObject({ workId: local.workId, kind: 'build', status: 'Ready' });
  expect(records.body(local.workId, 'brief')).toBe('Build scope.');
  expect(writes).toHaveLength(1);
});

test('Azure conversion uses the team default area, selected options and backlog fallback, and respects read-only access', async () => {
  const { records, repo, deps } = await setup();
  const azure = 'example/Project/source';
  const local = records.create({ repository: azure, kind: 'bug', title: 'Fix export', context: 'Steps.' });
  repo.repo = azure;
  repo.setup!.repo = azure;
  repo.team = 'Team';
  repo.setup!.azureReadOnly = true;
  const writes: unknown[][] = [];
  deps.provider.creationTarget = async () => ({ type: 'Backlog Item', areaPath: 'Project\\Team' });
  deps.provider.create = async (...args) => { writes.push(args); return { repository: azure, number: 19 + writes.length, body: '', version: '1' }; };
  deps.discoverOptions = async () => ({ ...options, provider: 'azure', iterations: ['Project\\Sprint'] });
  const request = { requestId: REQUEST, revision: local.revision, options: { type: 'Bug', labels: ['bug'], assignee: 'person', iteration: 'Project\\Sprint' } };
  const refused = await createRecordTicket(local.workId, request, deps);
  expect(refused.body.error).toContain('read-only');
  expect(writes).toHaveLength(0);
  repo.setup!.azureReadOnly = undefined;
  const created = await createRecordTicket(local.workId, { ...request, requestId: SECOND }, deps);
  expect(created.body.record).toMatchObject({ workId: local.workId, ticket: `${azure}#20` });
  expect(writes[0]!.slice(3)).toEqual(['Bug', 'Project\\Team', { type: 'Bug', labels: ['bug'], assignee: 'person', iteration: 'Project\\Sprint' }]);
  const another = records.create({ repository: azure, kind: 'bug', title: 'Another failure', context: 'More steps.' });
  deps.discoverOptions = async () => { throw Error('No options'); };
  expect((await createRecordTicket(another.workId, { requestId: '33333333-3333-4333-8333-333333333333', revision: another.revision }, deps)).status).toBe(200);
  expect(writes[1]!.slice(3)).toEqual(['Backlog Item', 'Project\\Team', { labels: [], type: 'Backlog Item' }]);
});

test('concept and decision conversion use description and retro concepts retain their structure route', async () => {
  const { records, repo, deps, writes } = await setup();
  for (const kind of ['concept', 'decision'] as const) {
    const local = records.create({ repository: REPO, kind, title: 'Explore export', context: 'Authored description.' });
    records.setBody(local.workId, local.revision, kind === 'concept' ? 'map' : 'decision', 'Local refinement.');
    expect(recordTicketPreview(records, local.workId, [repo]).description).toBe('Authored description.');
    if (kind === 'concept') expect((await createRecordTicket(local.workId, { retro: true, requestId: REQUEST, revision: records.read(local.workId).revision }, deps)).body.error).toContain('structure sync');
  }
  expect(writes).toHaveLength(0);
});

test('a changed spec preference invalidates the preview before writing', async () => {
  const { records, local, repo, convert, writes } = await setup();
  const record = records.setBody(local.workId, local.revision, 'brief', 'Passing brief.');
  records.recordGate(record.workId, record.revision, { briefDigest: records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'pass' });
  const preview = recordTicketPreview(records, local.workId, [repo]);
  repo.setup!.writeRefinedSpec = false;
  expect((await convert({ preview })).body.error).toContain('settings changed');
  expect(writes).toHaveLength(0);
});

test('a confirmed ticket with a failed attachment can recover without creating a second record or issue', async () => {
  const { records, local, convert, writes } = await setup();
  const complete = records.completeCapture;
  records.completeCapture = () => { throw Error('Disk full'); };
  const failed = await convert();
  expect(failed.body.error).toContain(`Created ${REPO}#13`);
  expect(records.read(local.workId).ticket).toBeNull();
  records.completeCapture = complete;
  const recovered = await convert();
  expect(recovered.body.record).toMatchObject({ workId: local.workId, ticket: `${REPO}#13` });
  expect(records.list({})).toHaveLength(1);
  expect(writes).toHaveLength(1);
});

test('conversion preserves the exact stored title shown in its preview', async () => {
  const { records, deps, writes } = await setup();
  const record = records.create({ repository: REPO, kind: 'bug', title: '  Fix export  ', context: 'Original.' });
  expect((await createRecordTicket(record.workId, { requestId: REQUEST, revision: record.revision }, deps)).status).toBe(200);
  expect(writes[0]![1]).toBe('  Fix export  ');
});


test.each(['attachment', 'checkpoint'])('replaying a confirmed conversion activates its Spec after a failed %s', async stage => {
  const { records, local, deps, convert } = await setup();
  const brief = records.setBody(local.workId, local.revision, 'brief', 'Gated Spec.');
  records.recordGate(local.workId, brief.revision, { briefDigest: records.gate(local.workId).briefDigest!, approvedBy: 'user', evidence: 'pass' });
  let created: StructureTicket;
  let creates = 0;
  deps.provider.create = async (repository, title, body) => {
    creates++;
    return created = { repository, number: 31, title, body, version: '1' };
  };
  deps.provider.readSpec = async () => created;
  const complete = records.completeCapture;
  const save = records.saveSpecState;
  if (stage === 'attachment') records.completeCapture = () => { throw Error('Disk full'); };
  else records.saveSpecState = () => { throw Error('Disk full'); };
  expect((await convert()).status).toBe(502);
  records.completeCapture = complete;
  records.saveSpecState = save;
  expect((await convert()).status).toBe(200);
  expect(records.specState(local.workId)).toMatchObject({ active: true, base: { body: created!.body }, original: 'Original request.' });
  expect(creates).toBe(1);
});

test.each(['attachment', 'checkpoint', 'response'].flatMap(stage => [true, false, undefined].map(editorWrite => ({ stage, editorWrite }))))(
  'recovery checks provenance of edits before retry after a failed $stage, editorWrite=$editorWrite', async ({ stage, editorWrite }) => {
  const { records, local, deps, convert } = await setup();
  const brief = records.setBody(local.workId, local.revision, 'brief', 'Gated Spec.');
  records.recordGate(local.workId, brief.revision, { briefDigest: records.gate(local.workId).briefDigest!, approvedBy: 'user', evidence: 'pass' });
  let remote!: StructureTicket;
  let creates = 0;
  deps.provider.create = async (repository, title, body) => {
    creates++;
    remote = { repository, number: 31, title, body, version: '1' };
    if (stage === 'response') throw Error('Response lost');
    return remote;
  };
  deps.provider.find = async () => [remote];
  deps.provider.readSpec = async () => remote;
  const complete = records.completeCapture;
  const save = records.saveSpecState;
  if (stage === 'attachment') records.completeCapture = () => { throw Error('Disk full'); };
  else if (stage === 'checkpoint') records.saveSpecState = () => { throw Error('Disk full'); };
  expect((await convert()).status).toBe(stage === 'response' ? 409 : 502);
  records.completeCapture = complete;
  records.saveSpecState = save;
  remote = { ...remote, body: remote.body.replace('Gated Spec.', 'Edited on tracker.'), title: 'Edited title', version: '2', editorWrite, titleEditorWrite: editorWrite };
  const handle = opened[0]!;
  records.close();
  handle.records = await openWorkRecords(join(handle.dir, 'work-records.db'));
  deps.records = handle.records;
  const recovered = await createRecordTicket(local.workId, { requestId: REQUEST }, deps);
  expect(recovered.status).toBe(200);
  if (editorWrite) {
    expect(recovered.body.record?.title).toBe('Edited title');
    expect(handle.records.body(local.workId, 'brief')).toBe('Edited on tracker.');
    expect(handle.records.gate(local.workId).evidence.at(-1)?.source).toBe('tracker');
  } else {
    expect(recovered.body.record?.title).toBe('Fix export');
    expect(handle.records.body(local.workId, 'brief')).toBe('Gated Spec.');
    expect(handle.records.specState(local.workId)).toMatchObject({ held: { body: remote.body, title: 'Edited title' },
      base: { version: stage === 'response' ? '' : '1', body: expect.stringContaining('Gated Spec.') } });
    expect(handle.records.gate(local.workId).evidence.at(-1)?.source).toBe('gate');
  }
  expect(creates).toBe(1);
});


test.each([false, true])('retention purges capture prose and retains replay protection, conversion=%s', async conversion => {
  const { records, local, deps, convert, writes } = await setup();
  const draft = { repo: REPO, kind: 'bug', title: 'Private title', description: 'Private description', createIssue: true };
  if (conversion) {
    const brief = records.setBody(local.workId, local.revision, 'brief', 'Private conversion Spec.');
    records.recordGate(local.workId, brief.revision, { briefDigest: records.gate(local.workId).briefDigest!, approvedBy: 'user', evidence: 'pass' });
  }
  const result = conversion ? await convert() : await captureWork({ requestId: REQUEST, draft }, deps);
  expect(records.captureSubmission(REQUEST)!.draft).toContain(conversion ? 'Private conversion Spec.' : 'Private description');
  const record = result.body.record!;
  records.setAside(record.workId, record.revision);
  expect(records.deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }).deleted).toContain(record.workId);
  expect(records.captureSubmission(REQUEST)).toMatchObject({ draft: '', createdTicket: null, ticket: `${REPO}#13` });
  expect((await captureWork({ requestId: REQUEST, draft }, deps)).status).toBe(409);
  expect(() => records.completeCapture(REQUEST, { title: 'Replay', repository: REPO, kind: 'bug', ticket: `${REPO}#13` })).toThrow(/expired/i);
  expect(writes).toHaveLength(1);
  expect(records.list({}).map(record => record.workId)).toEqual(conversion ? [] : [local.workId]);
});

const NEW_LABEL_DRAFT = { repo: REPO, kind: 'bug', title: 'Fix export', description: 'Steps.', createIssue: true };
/** The setup, with label management allowed, the label operations recorded, and each create answered by `create`. */
async function withLabels(create: (name: string) => Promise<{ name: string }> = async (name) => ({ name })) {
  const made = await setup();
  made.repo.setup!.access['manage-labels'] = 'allowed';
  const created: string[] = [];
  const deps = { ...made.deps, labels: () => ({ create: async ({ name }: { name: string }) => { created.push(name); return create(name); } }) as unknown as TrackerLabels };
  const capture = (labels: object, requestId = REQUEST) => captureWork({ requestId, draft: { ...NEW_LABEL_DRAFT, options: labels } }, deps);
  return { ...made, deps, created, capture };
}

test('a new label is created when the ticket submits, and the ticket carries it', async () => {
  const { capture, created, writes } = await withLabels();
  expect((await capture({ labels: ['bug'], newLabels: ['needs-design'] })).status).toBe(200);
  expect(created).toEqual(['needs-design']);
  expect(writes[0]![5]).toEqual({ labels: ['bug', 'needs-design'], type: 'Bug' });
});

test('a failed label creation creates no ticket, shows the error and permits a new submission', async () => {
  let fail = true;
  const { capture, records, writes, created } = await withLabels(async (name) => {
    if (fail) throw Error('HTTP 500: label service down');
    return { name };
  });
  const before = records.list({}).length;
  const refused = await capture({ newLabels: ['needs-design'] });
  expect(refused.status).toBe(502);
  expect(refused.body.uncertain).toBeUndefined();
  expect(refused.body.error).toContain('needs-design');
  expect(refused.body.error).toContain('HTTP 500: label service down');
  expect(writes).toHaveLength(0);
  expect(records.list({})).toHaveLength(before);
  fail = false;
  expect((await capture({ newLabels: ['needs-design'] }, SECOND)).status).toBe(200);
  expect(created).toEqual(['needs-design', 'needs-design']);
  expect(writes).toHaveLength(1);
});

test('a typed name the tracker already has is used as it is, not created again', async () => {
  const { capture, created, writes, deps } = await withLabels();
  deps.discoverOptions = async () => ({ ...options, labels: ['bug', 'Needs-Design'] });
  expect((await capture({ labels: [], newLabels: ['needs-design'] })).status).toBe(200);
  expect(created).toEqual([]);
  expect(writes[0]![5]).toMatchObject({ labels: ['Needs-Design'] });
});

test.each(['manage-labels', 'tag-ticket'])('a new label without %s is refused before anything is written', async (operation) => {
  const { capture, repo, created, writes } = await withLabels();
  repo.setup!.access[operation as 'tag-ticket'] = 'refused';
  const refused = await capture({ newLabels: ['needs-design'] });
  expect(refused.status).toBe(403);
  expect(refused.body.error).toContain(operation);
  expect(created).toEqual([]);
  expect(writes).toHaveLength(0);
});

test('a new label is not dropped when the tracker\'s labels could not be read: nothing is created', async () => {
  const { capture, created, writes, deps } = await withLabels();
  deps.discoverOptions = async () => { throw Error('No options'); };
  const refused = await capture({ newLabels: ['needs-design'] });
  expect(refused.status).toBe(502);
  expect(refused.body.error).toContain('needs-design');
  expect(created).toEqual([]);
  expect(writes).toHaveLength(0);
});

test.each([['linked-work', /reserved/], ['bug', /reserved/], ['status-done', /reserved/], ['-flag', /hyphen/]])('a typed name %s is refused with its reason', async (name, reason) => {
  const { capture, created, writes } = await withLabels();
  const refused = await capture({ newLabels: [name] });
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatch(reason);
  expect(created).toEqual([]);
  expect(writes).toHaveLength(0);
});

test('local work with Create issue off gets no labels, even with new ones in its draft', async () => {
  const { deps, created, writes } = await withLabels();
  const result = await captureWork({ requestId: REQUEST, draft: { ...NEW_LABEL_DRAFT, createIssue: false, options: { labels: ['bug'], newLabels: ['needs-design'] } } }, deps);
  expect(result.status).toBe(200);
  expect(result.body.record?.ticket).toBeNull();
  expect(created).toEqual([]);
  expect(writes).toHaveLength(0);
});

test('on Azure a new tag has no create of its own: it goes on the work item, and a refusal creates no ticket', async () => {
  const { records, repo, deps, created } = await withLabels();
  const azure = 'example/Project/source';
  repo.repo = azure;
  repo.setup!.repo = azure;
  repo.team = 'Team';
  const writes: unknown[][] = [];
  deps.provider.creationTarget = async () => ({ type: 'Bug', areaPath: 'Project\\Team' });
  deps.provider.create = async (...args) => { writes.push(args); return { repository: azure, number: 21, body: '', version: '1' }; };
  deps.discoverOptions = async () => ({ ...options, provider: 'azure', labels: ['bug'] });
  const draft = { ...NEW_LABEL_DRAFT, repo: azure, options: { labels: ['bug'], newLabels: ['needs-design'] } };
  expect((await captureWork({ requestId: REQUEST, draft }, deps)).status).toBe(200);
  expect(created).toEqual([]);
  expect(writes[0]![5]).toMatchObject({ labels: ['bug', 'needs-design'] });
  deps.provider.create = async () => { throw Error('HTTP 403: not allowed to create tags'); };
  const before = records.list({}).length;
  const refused = await captureWork({ requestId: SECOND, draft }, deps);
  expect(refused.status).toBe(502);
  expect(refused.body.uncertain).toBeUndefined();
  expect(refused.body.error).toContain('not allowed to create tags');
  expect(records.list({})).toHaveLength(before);
  const bad = await captureWork({ requestId: '33333333-3333-4333-8333-333333333333', draft: { ...draft, options: { newLabels: ['a;b'] } } }, deps);
  expect(bad.body.error).toMatch(/semicolons/);
});
