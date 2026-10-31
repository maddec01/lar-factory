import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { effectiveVocabulary, type PublicationPlan } from '@lar-factory/shared';
import type { PublicationSettings } from '@lar-factory/shared/publication-settings';
import { openWorkRecords, type WorkRecords } from './work-records.ts';
import { publicationEngine, PublicationConflict, type PublicationDocument } from './publication-engine.ts';
import { publicationProvider, PublicationRefused } from './publication-providers.ts';

type Provider = 'github' | 'azure';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach((close) => close()));
async function fixture(provider: Provider, picked = true) {
  const dir = mkdtempSync(join(tmpdir(), 'existing-publication-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'records.db');
  const records = await openWorkRecords(path); cleanup.push(() => records.close());
  const repository = provider === 'github' ? 'team/app' : 'contoso/project/app';
  const url = provider === 'github' ? 'https://github.com/team/app/issues/12' : 'https://dev.azure.com/contoso/project/_workitems/edit/12';
  const ticket = `${repository}#12`;
  let work = records.create({ title: 'Search', repository, kind: 'build', ...(picked ? { ticket } : {}) });
  work = records.setBody(work.workId, work.revision, 'brief', 'Private brief that remains usable.');
  records.recordGate(work.workId, work.revision, { briefDigest: records.gate(work.workId).briefDigest!, approvedBy: 'reviewer', evidence: 'Passed.' });
  const document: PublicationDocument = { workId: work.workId, title: 'Find searches', outcome: 'Find saved searches by name.', change: 'Add a name filter.', checks: ['Matching searches appear.'],
    assumptions: [], decisions: [], builderNotes: [], domainNotes: [], relatedTickets: [] };
  const config: PublicationSettings = { snapshot: 'original', discovery: { provider, types: { state: 'available', choices: ['Task'] }, labels: { state: 'available', choices: [] } },
    setup: { repo: repository, role: '', itemSource: provider === 'github' ? { kind: 'issues' } : { kind: 'azure-board', team: 'Team' }, labels: [], domainDocs: { kind: 'private' }, skills: [],
      ...effectiveVocabulary({ build: { type: 'Task', labels: [] } }), access: {} as PublicationSettings['setup']['access'],
      consent: ['edit-ticket', 'comment-ticket', 'publish-ticket'], paused: [], sources: {} as PublicationSettings['setup']['sources'], shared: {} } };
  const state = { body: 'Author description.', format: provider === 'azure' ? 'HTML' : 'Markdown', revision: 3, repro: undefined as string | undefined, workItemType: 'Task', assigned: false, linked: false,
    refuseBody: false, refuseComment: false, normalize: false, refuseVerification: false, lost: '' as '' | 'body' | 'comment' | 'replace-comment', race: false };
  const comments = new Map<string, string>(); const writes: { kind: string; payload: unknown }[] = [];
  const writeBody = (body: string, payload: unknown, field = 'System.Description') => {
    if (state.refuseBody) throw new Error('HTTP 403 body edit refused.');
    writes.push({ kind: 'body', payload });
    if (field === 'Microsoft.VSTS.TCM.ReproSteps') state.repro = body;
    else state.body = state.normalize ? body.replace('Author description.', 'Author changed text.') : body;
    state.revision++;
    if (state.lost === 'body') { state.lost = ''; throw new Error('Lost body write response.'); }
  };
  const writeComment = (body: string, id?: string) => {
    if (state.refuseComment) throw new Error('HTTP 403 comment refused.');
    const kind = id ? 'replace-comment' : 'comment';
    const commentId = id ?? String(comments.size + 20);
    comments.set(commentId, body); writes.push({ kind, payload: body });
    if (state.lost === kind) { state.lost = ''; throw new Error('Lost comment response.'); }
    return JSON.stringify({ id: Number(commentId) });
  };
  const adapter = publicationProvider({
    github: async (args, input) => {
      const path = args.find((a) => a.startsWith('repos/'))!;
      const payload = input ? JSON.parse(input) : undefined;
      if (args.includes('PATCH')) {
        if (path.includes('/issues/comments/')) return writeComment(payload.body, path.split('/').at(-1));
        writeBody(payload.body, payload); return '{}';
      }
      if (args.includes('POST') && path.endsWith('/comments')) return writeComment(payload.body);
      if (path.includes('/timeline?')) return JSON.stringify([[...(state.linked ? [{ source: { issue: { pull_request: { url: 'https://api.github.com/repos/team/app/pulls/5' } } } }] : [])]]);
      if (path.includes('/comments?')) return JSON.stringify([[...comments].map(([id, body]) => ({ id: Number(id), body }))]);
      if (state.refuseVerification && writes.some((w) => w.kind === 'body')) throw new Error('HTTP 403 verification refused.');
      return JSON.stringify({ number: 12, html_url: url, body: state.body, assignees: state.assigned ? [{ login: 'teammate' }] : [] });
    },
    azure: async (args) => {
      const file = args.includes('--in-file') ? args[args.indexOf('--in-file') + 1] : args.includes('--body') ? args[args.indexOf('--body') + 1]!.slice(1) : undefined;
      const payload = file ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
      if (args[0] === 'rest') {
        if (state.race) { state.race = false; state.revision++; state.body += '<p>Concurrent teammate edit</p>'; }
        if (payload[0].value !== state.revision) throw new Error('HTTP 412 TF26071 revision changed.');
        writeBody(payload[1].value, payload, payload[1].path.slice('/fields/'.length)); return '{}';
      }
      if (args.includes('workitemsbatch') && state.refuseVerification && writes.some((w) => w.kind === 'body')) throw new Error('HTTP 403 verification refused.');
      if (args.includes('workitemsbatch')) return JSON.stringify({ value: [{ id: 12, rev: state.revision, fields: { 'System.Description': state.body, 'Microsoft.VSTS.TCM.ReproSteps': state.repro, 'System.WorkItemType': state.workItemType, 'System.AssignedTo': state.assigned ? { displayName: 'Teammate' } : null },
        multilineFieldsFormat: { 'System.Description': state.format, 'Microsoft.VSTS.TCM.ReproSteps': state.format }, relations: state.linked ? [{ rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/project%2Frepo%2F5' }] : [] }] });
      if (args.includes('comments')) {
        const id = args.find((a) => a.startsWith('commentId='))?.slice(10);
        if (args.includes('POST') || args.includes('PATCH')) return writeComment(payload.text, id);
        return JSON.stringify(id ? { id: Number(id), text: comments.get(id) } : { comments: [...comments].map(([id, text]) => ({ id: Number(id), text })) });
      }
      throw new Error(`Unexpected controlled Azure call ${args.join(' ')}`);
    },
  });
  const engineFor = (journal: WorkRecords) => publicationEngine(journal, { provider: adapter, settings: async () => config });
  const engine = engineFor(records);
  const approve = (plan: PublicationPlan, journal = records) => journal.approvePublication(work.workId, plan.planId, plan.revision, plan.digest, 'person');
  const prepare = (replaces?: string, change = document.change) => engine.prepare(work.workId, { documents: [{ ...document, change }], ...(replaces ? { replaces } : {}) });
  return { dir, records, path, work, ticket, url, document, config, state, comments, writes, engine, engineFor, approve, prepare };
}

it.each<Provider>(['github', 'azure'])('preserves picked %s descriptions and unrelated text on append and exact replacement', async (provider) => {
  const f = await fixture(provider);
  const original = provider === 'azure' ? '<table style="color:blue"><tr><td rowspan="2" colspan="3">Author &amp; team</td></tr></table>' : 'Author **description**.';
  f.state.body = original;
  const first = await f.prepare();
  expect(f.writes).toEqual([]); expect(first.operations).toHaveLength(1);
  f.approve(first); expect((await f.engine.execute(f.work.workId, first.planId, 'cli')).successful).toHaveLength(1);
  const text = f.records.lastPublished(f.work.workId)[0]!.text;
  expect(f.state.body).toBe(original + text);
  if (provider === 'azure') expect(f.writes[0]!.payload).toEqual([{ op: 'test', path: '/rev', value: 3 }, { op: 'add', path: '/fields/System.Description', value: original + text }]);
  f.state.body = 'Teammate prefix\n' + f.state.body + '\nTeammate suffix';
  const update = await f.prepare(first.planId, 'Filter by prefix.');
  expect(update.operations[0]).toMatchObject({ kind: 'replace', expectedText: text });
  f.approve(update); await f.engine.execute(f.work.workId, update.planId, 'board');
  const replacement = f.records.lastPublished(f.work.workId).filter((p) => p.location.kind === 'body');
  expect(replacement).toHaveLength(1);
  expect(f.state.body).toBe('Teammate prefix\n' + original + replacement[0]!.text + '\nTeammate suffix');
  expect(f.state.body).toContain('Filter by prefix.');
  expect(JSON.stringify(f.writes)).not.toMatch(/System.State|Priority|AssignedTo|workId/);
});

it.each<Provider>(['github', 'azure'])('requires a %s teammate conflict resolution and fresh approval before writing', async (provider) => {
  const f = await fixture(provider); const first = await f.prepare(); f.approve(first); await f.engine.execute(f.work.workId, first.planId, 'cli');
  const saved = f.records.lastPublished(f.work.workId)[0]!;
  f.state.body = f.state.body.replace('Add a name filter.', 'Teammate wording.');
  const observed = f.state.body;
  await expect(f.prepare(first.planId, 'Filter by prefix.')).rejects.toMatchObject({ conflict: { stored: saved.text, current: observed, proposed: expect.stringContaining('Filter by prefix.') } });
  expect(f.records.publications(f.work.workId)).toHaveLength(1);
  const current = observed.slice(saved.location.kind === 'body' ? saved.location.start : 0);
  const resolution = { observedText: observed, expectedText: current, location: { kind: 'body' as const, start: observed.indexOf(current), end: observed.length } };
  f.state.body += 'Another edit.';
  await expect(f.engine.prepare(f.work.workId, { documents: [f.document], replaces: first.planId, resolutions: { [f.work.workId]: resolution } })).rejects.toBeInstanceOf(PublicationConflict);
  f.state.body = observed;
  const resolved = await f.engine.prepare(f.work.workId, { documents: [{ ...f.document, change: 'Filter by prefix.' }], replaces: first.planId, resolutions: { [f.work.workId]: resolution } });
  await f.engine.execute(f.work.workId, resolved.planId, 'cli'); expect(f.writes).toHaveLength(1);
  f.approve(resolved); await f.engine.execute(f.work.workId, resolved.planId, 'cli');
  expect(f.state.body).toContain('Filter by prefix.'); expect(f.writes).toHaveLength(2);
});

it.each(['missing', 'duplicate', 'ambiguous'] as const)('requires resolution for %s published boundaries', async (change) => {
  const f = await fixture('github'); const first = await f.prepare(); f.approve(first); await f.engine.execute(f.work.workId, first.planId, 'cli');
  const saved = f.records.lastPublished(f.work.workId)[0]!;
  if (change === 'missing') f.state.body = 'Author description.\nTeammate replacement.';
  if (change === 'duplicate') f.state.body += saved.text;
  if (change === 'ambiguous') f.state.body += '\n<!-- refined-description -->Another section<!-- /refined-description -->';
  await expect(f.prepare(first.planId)).rejects.toMatchObject({ conflict: { stored: saved.text, current: f.state.body, proposed: expect.any(String) } });
  expect(f.writes).toHaveLength(1);
});

it.each<Provider>(['github', 'azure'])('invalidates %s approval when text changes before dispatch', async (provider) => {
  const f = await fixture(provider); const plan = await f.prepare(); f.approve(plan);
  f.state.body += '\nTeammate edit.';
  const result = await f.engine.execute(f.work.workId, plan.planId, 'cli');
  expect(result).toMatchObject({ current: false, conflicts: [{ current: f.state.body, proposed: expect.any(String) }] });
  expect(f.writes).toEqual([]); expect(result.plan.results[0]!.status).toBe('pending');
});

it.each<Provider>(['github', 'azure'])('adds an exact approved notice for assigned and PR-linked %s tickets only', async (provider) => {
  for (const trigger of ['assigned', 'linked', 'none'] as const) {
    const f = await fixture(provider); f.state.assigned = trigger === 'assigned'; f.state.linked = trigger === 'linked';
    const plan = await f.prepare();
    expect(plan.operations.map((op) => op.kind)).toEqual(trigger === 'none' ? ['append'] : ['append', 'comment']);
    if (trigger !== 'none') expect(plan.operations[1]).toMatchObject({ content: 'Updated the refined description with the agreed outcome and completion checks.', purpose: 'notice' });
    f.approve(plan); await f.engine.execute(f.work.workId, plan.planId, 'cli');
    expect(f.writes.map((write) => write.kind)).toEqual(trigger === 'none' ? ['body'] : ['body', 'comment']);
    expect(f.records.lastPublished(f.work.workId)).toHaveLength(1);
  }
});

it.each<Provider>(['github', 'azure'])('offers separately approved %s comments after body refusal and handover after comment refusal', async (provider) => {
  const f = await fixture(provider); f.state.refuseBody = true;
  const plan = await f.prepare(); f.approve(plan);
  expect((await f.engine.execute(f.work.workId, plan.planId, 'cli')).failed).toHaveLength(1);
  const comment = await f.engine.fallback(f.work.workId, plan.planId);
  expect(comment.operations).toEqual([{ operationId: expect.any(String), ticketWorkId: f.work.workId, kind: 'comment', content: comment.tickets[0]!.body, dependsOn: [] }]);
  await f.engine.execute(f.work.workId, comment.planId, 'cli'); expect(f.writes).toEqual([]);
  f.approve(comment); f.state.refuseComment = true;
  expect((await f.engine.execute(f.work.workId, comment.planId, 'cli')).failed).toHaveLength(1);
  const handover = await f.engine.fallback(f.work.workId, comment.planId);
  expect(handover.operations).toEqual([]);
  expect(f.records.publicationHandover(f.work.workId, handover.planId)).toContain('Add a name filter.');
  expect(f.records.body(f.work.workId, 'brief')).toBe('Private brief that remains usable.');
  expect(f.writes).toEqual([]);
});

it.each<Provider>(['github', 'azure'])('replaces only its %s publication comment and resolves teammate edits explicitly', async (provider) => {
  const f = await fixture(provider);
  const plan = await f.engine.prepare(f.work.workId, { documents: [f.document], delivery: { [f.work.workId]: 'comment' } }); f.approve(plan);
  await f.engine.execute(f.work.workId, plan.planId, 'cli');
  const id = [...f.comments.keys()][0]!; f.comments.set('99', 'Unrelated teammate comment.');
  const update = await f.prepare(plan.planId, 'Filter by prefix.');
  expect(update.operations[0]).toMatchObject({ kind: 'replace-comment', location: { kind: 'comment', commentId: id }, expectedText: plan.tickets[0]!.body });
  f.approve(update); await f.engine.execute(f.work.workId, update.planId, 'cli');
  expect(f.comments.get('99')).toBe('Unrelated teammate comment.'); expect(f.comments.get(id)).toContain('Filter by prefix.');
  f.comments.set(id, 'Teammate changed the comment.');
  await expect(f.prepare(update.planId)).rejects.toMatchObject({ conflict: { current: 'Teammate changed the comment.', stored: update.tickets[0]!.body } });
  const resolved = await f.engine.prepare(f.work.workId, { documents: [f.document], replaces: update.planId, resolutions: { [f.work.workId]: {
    observedText: 'Teammate changed the comment.', expectedText: 'Teammate changed the comment.', location: { kind: 'comment', commentId: id } } } });
  f.approve(resolved); await f.engine.execute(f.work.workId, resolved.planId, 'cli');
  f.comments.delete(id);
  await expect(f.prepare(resolved.planId)).rejects.toMatchObject({ conflict: { current: '', reason: expect.stringContaining('missing') } });
});

it('offers a comment or handover when Azure cannot preserve the raw description format', async () => {
  const f = await fixture('azure'); f.state.format = 'Unknown';
  await expect(f.prepare()).rejects.toBeInstanceOf(PublicationRefused);
  const plan = await f.engine.prepare(f.work.workId, { documents: [f.document], delivery: { [f.work.workId]: 'comment' } });
  expect(plan.operations[0]).toMatchObject({ kind: 'comment', content: plan.tickets[0]!.body });
  f.approve(plan); await f.engine.execute(f.work.workId, plan.planId, 'cli');
  expect(f.state.body).toBe('Author description.');
});

it('uses Azure conditional protection if a teammate writes between the reread and PATCH', async () => {
  const f = await fixture('azure'); const plan = await f.prepare(); f.approve(plan); f.state.race = true;
  expect((await f.engine.execute(f.work.workId, plan.planId, 'cli')).failed).toHaveLength(1);
  expect(f.writes).toEqual([]); expect(f.state.body).toContain('Concurrent teammate edit');
});

it.each<Provider>(['github', 'azure'])('prepares a complete read-only %s handover and attaches its posted URL without replacing local work', async (provider) => {
  const f = await fixture(provider, false); f.config.setup.consent = []; f.config.setup.access['publish-ticket'] = 'refused';
  const plan = await f.engine.prepare(f.work.workId, { documents: [f.document], delivery: { [f.work.workId]: 'handover' } });
  expect(plan.operations).toEqual([]); expect(f.records.publicationHandover(f.work.workId, plan.planId)).toContain('## Completion checks\n\n- Matching searches appear.');
  f.records.attachPublicationUrl(f.work.workId, f.records.read(f.work.workId).revision, plan.planId, f.ticket, f.url);
  expect(f.records.read(f.work.workId)).toMatchObject({ workId: f.work.workId, ticket: f.ticket, status: 'List' });
  expect(f.records.body(f.work.workId, 'brief')).toBe('Private brief that remains usable.'); expect(f.writes).toEqual([]);
  const other = await openWorkRecords(join(f.dir, 'other-user.db')); cleanup.push(() => other.close());
  const picked = other.create({ title: f.document.title, repository: f.work.repository, kind: 'build', ticket: f.ticket });
  other.setBody(picked.workId, picked.revision, 'brief', f.records.publicationHandover(f.work.workId, plan.planId));
  expect(picked.workId).not.toBe(f.work.workId); expect(other.body(picked.workId, 'brief')).toContain('Add a name filter.');
});

it.each<Provider>(['github', 'azure'])('reconciles lost %s append, replacement and comment responses after restart without retrying', async (provider) => {
  for (const kind of ['body', 'replace-body', 'comment', 'replace-comment'] as const) {
    const f = await fixture(provider);
    let previous: PublicationPlan | undefined;
    if (kind.startsWith('replace-')) {
      previous = await f.engine.prepare(f.work.workId, { documents: [f.document], ...(kind === 'replace-comment' ? { delivery: { [f.work.workId]: 'comment' as const } } : {}) });
      f.approve(previous); await f.engine.execute(f.work.workId, previous.planId, 'cli');
    }
    const plan = await f.engine.prepare(f.work.workId, { documents: [{ ...f.document, change: 'Filter by prefix.' }], ...(previous ? { replaces: previous.planId } : {}),
      ...(kind === 'comment' ? { delivery: { [f.work.workId]: 'comment' as const } } : {}) });
    f.state.lost = kind === 'replace-body' ? 'body' : kind;
    f.approve(plan); expect((await f.engine.execute(f.work.workId, plan.planId, 'cli')).uncertain).toHaveLength(1);
    const count = f.writes.length;
    const reopened = await openWorkRecords(f.path); cleanup.push(() => reopened.close()); const engine = f.engineFor(reopened);
    expect((await engine.resume(f.work.workId, plan.planId, 'board')).uncertain).toHaveLength(1); expect(f.writes).toHaveLength(count);
    const result = await engine.reconcile(f.work.workId, plan.planId, 'person');
    if (kind.includes('comment')) {
      expect(result.uncertain).toHaveLength(1);
      await engine.reconcile(f.work.workId, plan.planId, 'person', [{ operationId: plan.operations[0]!.operationId, commentId: result.candidates[0]!.comments![0]! }]);
    } else expect(result.uncertain).toEqual([]);
    expect((await engine.resume(f.work.workId, plan.planId, 'board')).uncertain).toEqual([]); expect(f.writes).toHaveLength(count);
    expect(reopened.lastPublished(f.work.workId).at(-1)!.text).toContain('Filter by prefix.');
  }
});

it.each<Provider>(['github', 'azure'])('keeps successful %s body writes when a required notice is refused', async (provider) => {
  const f = await fixture(provider); f.state.assigned = true; f.state.refuseComment = true;
  const plan = await f.prepare(); f.approve(plan);
  const result = await f.engine.execute(f.work.workId, plan.planId, 'cli');
  expect(result.successful).toEqual([plan.operations[0]!.operationId]); expect(result.failed).toEqual([plan.operations[1]!.operationId]);
  const handover = await f.engine.fallback(f.work.workId, plan.planId, 'handover');
  expect(handover.results).toMatchObject([{ status: 'successful', operation: { kind: 'append' } }]);
  expect(f.records.publicationHandover(f.work.workId, handover.planId)).not.toContain('<pre>');
  f.approve(handover); await f.engine.resume(f.work.workId, handover.planId, 'cli');
  expect(f.writes).toHaveLength(1);
});

it.each<Provider>(['github', 'azure'])('offers a %s handover when both body and comment consent are withheld', async (provider) => {
  const f = await fixture(provider); f.config.setup.consent = [];
  const plan = await f.prepare(); f.approve(plan);
  expect((await f.engine.execute(f.work.workId, plan.planId, 'cli')).current).toBe(false);
  const comment = await f.engine.fallback(f.work.workId, plan.planId); f.approve(comment);
  expect((await f.engine.execute(f.work.workId, comment.planId, 'cli')).current).toBe(false);
  const handover = await f.engine.fallback(f.work.workId, comment.planId);
  expect(handover.operations).toEqual([]); expect(f.writes).toEqual([]);
});

it.each<Provider>(['github', 'azure'])('keeps a %s write uncertain when the provider does not store the exact raw text', async (provider) => {
  const f = await fixture(provider); f.state.normalize = true;
  const plan = await f.prepare(); f.approve(plan);
  expect((await f.engine.execute(f.work.workId, plan.planId, 'cli')).uncertain).toHaveLength(1);
  expect(f.records.lastPublished(f.work.workId)).toEqual([]);
  expect((await f.engine.reconcile(f.work.workId, plan.planId, 'person')).uncertain).toHaveLength(1);
  expect(f.writes).toHaveLength(1);
});

it.each<Provider>(['github', 'azure'])('never treats a refused %s verification read as proof that the accepted write failed', async (provider) => {
  const f = await fixture(provider); f.state.refuseVerification = true;
  const plan = await f.prepare(); f.approve(plan);
  const result = await f.engine.execute(f.work.workId, plan.planId, 'cli');
  expect(result.uncertain).toHaveLength(1); expect(result.failed).toEqual([]); expect(f.writes).toHaveLength(1);
  expect((await f.engine.resume(f.work.workId, plan.planId, 'cli')).uncertain).toHaveLength(1); expect(f.writes).toHaveLength(1);
});

it('preserves and records an Azure Bug description in Repro Steps across later unrelated Description edits', async () => {
  const f = await fixture('azure'); f.state.workItemType = 'Bug'; f.state.body = '<div><br></div>';
  const original = '<table><tr><td colspan="2" style="color:red">Reproduce this</td></tr></table>'; f.state.repro = original;
  const first = await f.prepare();
  expect(first.operations[0]).toMatchObject({ kind: 'append', location: { field: 'Microsoft.VSTS.TCM.ReproSteps' } });
  f.approve(first); await f.engine.execute(f.work.workId, first.planId, 'cli');
  expect(f.state.body).toBe('<div><br></div>'); expect(f.state.repro).toContain(original);
  expect(f.records.lastPublished(f.work.workId)[0]!.location).toMatchObject({ field: 'Microsoft.VSTS.TCM.ReproSteps' });
  f.state.body = '<p>Unrelated teammate description</p>';
  const update = await f.prepare(first.planId, 'Filter by prefix.'); f.approve(update); await f.engine.execute(f.work.workId, update.planId, 'cli');
  expect(f.state.body).toBe('<p>Unrelated teammate description</p>'); expect(f.state.repro).toContain(original); expect(f.state.repro).toContain('Filter by prefix.');
});

it('attaches a manually posted comment URL to a picked ticket and reuses it in later publication', async () => {
  const f = await fixture('github'); f.config.setup.consent = [];
  const plan = await f.engine.prepare(f.work.workId, { documents: [f.document], delivery: { [f.work.workId]: 'handover' } });
  const posted = f.url + '#issuecomment-20';
  f.records.attachPublicationUrl(f.work.workId, f.records.read(f.work.workId).revision, plan.planId, f.ticket, posted);
  expect(f.records.publicationAttachment(f.work.workId)).toMatchObject({ ticket: f.ticket, url: posted });
  expect(f.records.read(f.work.workId)).toMatchObject({ workId: f.work.workId, ticket: f.ticket });
  expect(f.records.body(f.work.workId, 'brief')).toBe('Private brief that remains usable.');
  const next = await f.prepare(plan.planId);
  expect(next.tickets[0]!.destination).toMatchObject({ ticket: f.ticket, url: posted });
  expect(f.writes).toEqual([]);
});
