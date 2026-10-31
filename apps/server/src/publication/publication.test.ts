import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import sample from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import type { BoardData } from '@lar-factory/shared';
import { createBoardServer, type HttpDeps } from '../http/http.ts';
import { createBoardState } from '../board/board-state.ts';
import { PublicationRefused } from '@lar-factory/work-records/publication-providers';
import { afterEach, expect, onTestFinished, test, vi } from 'vite-plus/test';
import { effectiveVocabulary, type PublicationBoardState, type PublicationTicket } from '@lar-factory/shared';
import type { PublicationSettings } from '@lar-factory/shared/publication-settings';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import type { PublicationProvider } from '@lar-factory/work-records/publication-providers';
import { createPublication } from './publication.ts';

const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => { for (const { records, dir } of opened.splice(0)) { records.close(); rmSync(dir, { recursive: true, force: true }); } });
async function fixture(repo = 'team/app') {
  const dir = mkdtempSync(join(tmpdir(), 'board-publication-'));
  const records = await openWorkRecords(join(dir, 'records.db')); opened.push({ records, dir });
  let work = records.create({ title: 'Search', repository: repo, kind: 'build', status: 'Ready' });
  work = records.setBody(work.workId, work.revision, 'brief', 'Private brief.');
  records.recordGate(work.workId, work.revision, { briefDigest: records.gate(work.workId).briefDigest!, approvedBy: 'reviewer', evidence: 'Passed.' });
  const config: PublicationSettings = { snapshot: repo, discovery: { provider: repo === 'team/app' ? 'github' : 'azure', types: { state: 'available', choices: ['Task'] }, labels: { state: 'available', choices: [] } }, setup: {
    repo, role: '', itemSource: repo === 'team/app' ? { kind: 'issues' } : { kind: 'azure-board', team: 'Team' }, labels: [], domainDocs: { kind: 'private' }, skills: [], ...effectiveVocabulary({ build: { type: 'Task', labels: [] } }),
    access: {} as PublicationSettings['setup']['access'], consent: ['publish-ticket', 'type-ticket', 'relate-ticket', 'comment-ticket'], paused: [], sources: {} as PublicationSettings['setup']['sources'], shared: {},
  } };
  const create = vi.fn(async (_ticket: PublicationTicket) => ({ ticket: `${repo}#12`, url: 'https://tickets.example/12' }));
  const provider: PublicationProvider = { create, readBody: vi.fn(), writeBody: vi.fn(), replaceComment: vi.fn(), capability: async () => ({ available: true }), relate: vi.fn(), comment: vi.fn(), search: async () => [], inspect: vi.fn(), findComments: async () => [], hasRelationship: async () => false };
  const options = { settings: async () => config, provider, allowed: () => true };
  const publication = createPublication(records, options);
  const request = { documents: [{ workId: work.workId, title: 'Find searches', outcome: 'Find saved searches.', change: 'Add a filter.', checks: ['Search by name.'], assumptions: [], decisions: [], builderNotes: [], domainNotes: [], relatedTickets: [] }], sources: records.publicationReadiness(work.workId).sources.map(({ workId, revision }) => ({ workId, revision })) };
  return { records, work, config, create, provider, publication, options, request };
}
async function state(publication: ReturnType<typeof createPublication>, action: string, input: Record<string, unknown>) {
  const reply = await publication.request(action, input);
  expect(reply.status).toBe(200);
  return reply.body as PublicationBoardState;
}

test.each(['team/app', 'org/project/repo'])('the board previews, approves and recovers a stored plan for %s without changing Status or creating work', async (repo) => {
  const { records, work, publication, options, create, request } = await fixture(repo);
  const preview = await state(publication, 'prepare', { workId: work.workId, ...request });
  expect(create).not.toHaveBeenCalled();
  expect(preview.pending?.plan.tickets[0]).toMatchObject({ title: 'Find searches', body: expect.stringContaining('## Completion checks\n\n- Search by name.'), destination: { repository: repo } });
  const restarted = createPublication(records, options);
  const recovered = await state(restarted, 'open', { workId: work.workId });
  expect(recovered.pending?.plan.digest).toBe(preview.pending?.plan.digest);
  const plan = recovered.pending!.plan;
  const result = await state(restarted, 'approve', { workId: work.workId, planId: plan.planId, revision: plan.revision, digest: plan.digest });
  expect(result.pending).toMatchObject({ failed: [], uncertain: [], successful: [`create:${work.workId}`] });
  expect(result.pending?.plan.results[0]?.attempt?.url).toBe('https://tickets.example/12');
  expect(create).toHaveBeenCalledTimes(1);
  expect(records.read(work.workId).status).toBe('Ready');
  expect(records.list({})).toHaveLength(1);
});

async function http(publication: ReturnType<typeof createPublication>, sampleMode = false) {
  const board = createBoardState({ ...sample, capture: { enabled: true, session: 'current-session' } } as unknown as BoardData);
  // This fixture exercises only publication routes. Other route dependencies must never be called.
  const { server } = createBoardServer({ board, publication, sample: sampleMode, appSecret: 'secret', ready: async () => {},
    page: { template: '', assets: new Map() } } as HttpDeps);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  onTestFinished(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (action: string, input: object, headers: Record<string, string> = {}) => fetch(`${url}/api/publication/${action}`, {
    method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json', 'X-Board-Secret': 'secret', ...headers }, body: JSON.stringify({ session: 'current-session', ...input }),
  });
}

test.each(['team/app', 'org/project/repo'])('a complete guarded HTTP publication uses the engine for %s', async (repo) => {
  const { publication, work, request, create } = await fixture(repo);
  const post = await http(publication);
  expect((await post('open', { workId: work.workId }, { Origin: 'https://foreign.example' })).status).toBe(403);
  expect((await post('open', { workId: work.workId }, { 'X-Board-Secret': 'wrong' })).status).toBe(403);
  expect((await post('open', { workId: work.workId, session: 'old-session' })).status).toBe(409);
  expect((await post('open', { workId: 5 })).status).toBe(400);
  expect((await post('prepare', { workId: work.workId, ...request, documents: 'invalid' })).status).toBe(409);
  const preview = await (await post('prepare', { workId: work.workId, ...request })).json() as PublicationBoardState;
  expect(create).not.toHaveBeenCalled();
  const { planId, revision, digest } = preview.pending!.plan;
  const approved = await post('approve', { workId: work.workId, planId, revision, digest });
  expect(approved.status).toBe(200);
  expect((await approved.json() as PublicationBoardState).pending?.plan.results[0]?.attempt?.url).toBe('https://tickets.example/12');
  expect(create).toHaveBeenCalledTimes(1);
});

test('stale sources, settings and plan identities refuse approval before dispatch', async () => {
  const { records, work, config, create, publication, request } = await fixture();
  const preview = await state(publication, 'prepare', { workId: work.workId, ...request });
  const { planId, revision, digest } = preview.pending!.plan;
  const approval = { workId: work.workId, planId, revision, digest };
  expect((await publication.request('approve', { ...approval, digest: 'different-content' })).status).toBe(409);
  config.snapshot = 'changed-settings';
  expect((await publication.request('approve', approval)).status).toBe(409);
  config.snapshot = 'team/app';
  records.setBody(work.workId, records.read(work.workId).revision, 'brief', 'Changed private brief.');
  expect((await publication.request('approve', approval)).status).toBe(409);
  expect((await publication.request('prepare', { workId: work.workId, ...request })).status).toBe(409);
  expect(create).not.toHaveBeenCalled();
});

test('duplicate approval requests reject the pending execution and never duplicate a ticket', async () => {
  const { publication, work, request, provider, create } = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  provider.create = async (ticket) => { entered(); await wait; return create(ticket); };
  const preview = await state(publication, 'prepare', { workId: work.workId, ...request });
  const { planId, revision, digest } = preview.pending!.plan;
  const approval = { workId: work.workId, planId, revision, digest };
  const first = publication.request('approve', approval);
  await started;
  expect((await publication.request('approve', approval)).status).toBe(409);
  release();
  expect((await first).status).toBe(200);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await publication.request('approve', approval)).status).toBe(409);
});

test('exclusive type conflicts need an explicit choice, and refused consent never dispatches', async () => {
  const { records, publication, work, request, config, create } = await fixture();
  records.update(work.workId, records.read(work.workId).revision, { kind: 'bug' });
  config.setup.vocabulary.bug = { type: 'Bug', labels: [] };
  config.discovery.types = { state: 'available', choices: ['Task', 'Bug'] };
  const sources = records.publicationReadiness(work.workId).sources;
  expect((await publication.request('prepare', { workId: work.workId, ...request, sources })).status).toBe(409);
  const preview = await state(publication, 'prepare', { workId: work.workId, ...request, sources, typeSelections: { [work.workId]: null } });
  expect(preview.pending!.plan.tickets[0]?.typeResolution.selected).toBeNull();
  config.setup.access['publish-ticket'] = 'refused';
  const { planId, revision, digest } = preview.pending!.plan;
  const result = await state(publication, 'approve', { workId: work.workId, planId, revision, digest });
  expect(result.pending!.reasons.join(' ')).toContain('publish-ticket');
  expect(create).not.toHaveBeenCalled();
});

test('a multi-ticket publication retains creation links and needs new approval for refused relationship fallback', async () => {
  const { records, publication, work, request, provider } = await fixture();
  let parent = records.create({ title: 'Search everywhere', repository: 'team/app', kind: 'concept' });
  records.setParent(work.workId, records.read(work.workId).revision, parent.workId);
  parent = records.setBody(parent.workId, records.read(parent.workId).revision, 'map', 'Private destination.');
  records.setFogGone(parent.workId, parent.revision, true);
  provider.create = vi.fn(async (ticket) => ({ ticket: `team/app#${ticket.workId === parent.workId ? 1 : 2}`, url: `https://tickets.example/${ticket.workId === parent.workId ? 1 : 2}` }));
  provider.relate = async () => { throw new PublicationRefused('Native child links refused.'); };
  provider.comment = vi.fn(async () => 'comment-1');
  const preview = await state(publication, 'prepare', { workId: parent.workId,
    documents: [{ ...request.documents[0], workId: parent.workId, title: 'Search everywhere' }, ...request.documents], sources: records.publicationReadiness(parent.workId).sources });
  expect(preview.pending!.plan.tickets).toHaveLength(2);
  expect(preview.pending!.plan.operations.map((op) => op.kind)).toEqual(['create', 'create', 'relationship']);
  const { planId, revision, digest } = preview.pending!.plan;
  const result = await state(publication, 'approve', { workId: parent.workId, planId, revision, digest });
  expect(result.pending).toMatchObject({ failed: [expect.stringContaining('child:')], successful: [expect.stringContaining('create:'), expect.stringContaining('create:')], uncertain: [] });
  const fallback = await state(publication, 'fallback', { workId: parent.workId, planId });
  expect(provider.comment).not.toHaveBeenCalled();
  expect(fallback.pending!.plan.operations.at(-1)).toMatchObject({ kind: 'textual-relationship', content: 'Part of https://tickets.example/1' });
  const replacement = fallback.pending!.plan;
  expect(replacement.approval).toBeNull();
  const done = await state(publication, 'approve', { workId: parent.workId, planId: replacement.planId, revision: replacement.revision, digest: replacement.digest });
  expect(done.pending!.failed).toEqual([]);
  expect(provider.comment).toHaveBeenCalledTimes(1);
});

test('sample mode refuses every publication request before engine access', async () => {
  const { publication, create } = await fixture();
  const request = vi.spyOn(publication, 'request');
  const post = await http(publication, true);
  for (const action of ['open', 'prepare', 'approve', 'inspect', 'resume', 'reconcile', 'fallback']) {
    const response = await post(action, {});
    expect(response.status).toBe(403);
    expect((await response.json() as { error: string }).error).toContain('sample mode');
  }
  expect(request).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test('a lost creation response stays uncertain after restart and cannot be retried through approval or a replacement', async () => {
  const { records, publication, options, work, request, provider } = await fixture();
  provider.create = vi.fn(async () => { throw new Error('Connection lost after dispatch.'); });
  const preview = await state(publication, 'prepare', { workId: work.workId, ...request });
  const { planId, revision, digest } = preview.pending!.plan;
  const result = await state(publication, 'approve', { workId: work.workId, planId, revision, digest });
  expect(result.pending).toMatchObject({ uncertain: [`create:${work.workId}`], failed: [], successful: [] });
  const restarted = createPublication(records, options);
  const recovered = await state(restarted, 'open', { workId: work.workId });
  expect(recovered.pending!.uncertain).toEqual([`create:${work.workId}`]);
  expect((await restarted.request('prepare', { workId: work.workId, ...request, replaces: planId })).status).toBe(409);
  const reconciled = await state(restarted, 'reconcile', { workId: work.workId, planId });
  expect(reconciled.pending!.uncertain).toEqual([`create:${work.workId}`]);
  expect(reconciled.candidates?.[0]?.tickets).toEqual([]);
  expect(provider.create).toHaveBeenCalledTimes(1);
});

test('a superseded plan returns the fresh exact preview for approval', async () => {
  const { publication, work, request, create } = await fixture();
  const first = await state(publication, 'prepare', { workId: work.workId, ...request });
  const firstPlan = first.pending!.plan;
  const replacement = await state(publication, 'prepare', { workId: work.workId, ...request, replaces: firstPlan.planId,
    documents: [{ ...request.documents[0], change: 'Add a name filter and a clear button.' }] });
  const refused = await publication.request('approve', { workId: work.workId, planId: firstPlan.planId, revision: firstPlan.revision, digest: firstPlan.digest });
  expect(refused.status).toBe(409);
  expect((refused.body as PublicationBoardState).pending?.plan.digest).toBe(replacement.pending!.plan.digest);
  expect((refused.body as PublicationBoardState).pending?.plan.approval).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

test('a delivery plan from the shared journal uses its delivery engine when reopened on the board', async () => {
  const { publicationPr } = await import('@lar-factory/work-records/publication-pr');
  const { records, options, config, work, create } = await fixture();
  records.attachTicket(work.workId, records.read(work.workId).revision, 'team/app#8');
  records.setPullRequest(work.workId, records.read(work.workId).revision, 'team/app#12');
  const github = vi.fn(async () => JSON.stringify({ body: 'Ship search.\n\nCloses team/app#8', base: { ref: 'main', repo: { default_branch: 'main' } } }));
  const transport = { github, azure: vi.fn() };
  const delivery = publicationPr(records, { settings: async () => config, transport });
  const prepared = (await delivery.prepare(work.workId))!;
  const board = createPublication(records, { ...options, prTransport: transport });
  const opened = await state(board, 'open', { workId: work.workId });
  expect(opened.pending!.plan.planId).toBe(prepared.planId);
  const result = await state(board, 'approve', { workId: work.workId, planId: prepared.planId, revision: prepared.revision, digest: prepared.digest });
  expect(result.pending!.successful).toHaveLength(1);
  expect(result.pending!.reasons).toEqual([]);
  expect(github).toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
