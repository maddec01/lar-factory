import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { formatTicketSpec, readTicketSpec, type RepositorySetup } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from './work-records.ts';
import { refreshSpecs, resolveSpecEdit, editSpec, syncSpecs } from './spec-sync.ts';
import type { StructureProvider, StructureTicket } from './tracker-sync.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const db of opened.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const setup = { repo: 'example/widget', writeRefinedSpec: true, access: { 'edit-ticket': 'allowed' } } as unknown as RepositorySetup;
async function fixture(repository = setup.repo) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-sync-')); dirs.push(dir);
  const path = join(dir, 'records.db');
  const records = await openWorkRecords(path); opened.push(records);
  let remote: StructureTicket = { repository, number: 7, body: 'Authored request.', title: 'Work', version: '1', editorWrite: true, titleEditorWrite: true };
  let failure = false;
  const writes: string[] = [];
  const provider = {
    readSpec: async () => { if (failure) throw Error('Offline'); return { ...remote }; },
    replaceSpec: async (_ticket: StructureTicket, body: string) => { if (failure) throw Error('Offline'); writes.push(body); remote = { ...remote, body, version: String(Number(remote.version) + 1) }; return { ...remote }; },
  } as unknown as StructureProvider;
  let record = records.create({ title: 'Work', repository, kind: 'feature', ticket: `${repository}#7` });
  record = records.setBody(record.workId, record.revision, 'brief', '## What\nBuild it.');
  records.recordGate(record.workId, record.revision, { briefDigest: records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'Passed' });
  record = records.update(record.workId, record.revision, { status: 'Ready' });
  return { records, path, record, provider, writes, remote: () => remote, edit: (change: Partial<StructureTicket>) => { remote = { ...remote, ...change }; }, fail: (value: boolean) => { failure = value; } };
}

test('a failed gated Spec survives reopening and retries without moving Ready or losing Original', async () => {
  const f = await fixture(); f.fail(true);
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.specState(f.record.workId).error).toContain('Offline');
  expect(f.records.read(f.record.workId).status).toBe('Ready');
  f.records.close(); opened.splice(opened.indexOf(f.records), 1);
  const reopened = await openWorkRecords(f.path); opened.push(reopened); f.fail(false);
  await syncSpecs(reopened, { provider: f.provider, setups: [setup], workId: f.record.workId });
  expect(f.writes).toHaveLength(1);
  expect(readTicketSpec(f.writes[0]!)).toEqual({ marked: true, spec: '## What\nBuild it.', original: 'Authored request.' });
  expect(reopened.specState(f.record.workId)).toMatchObject({ active: true, pending: null, error: null });
  expect(reopened.read(f.record.workId).status).toBe('Ready');
});

test('a tracker edit wins a waiting write, preserves Ready and records the replaced unsent text in history', async () => {
  const f = await fixture();
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  let record = f.records.read(f.record.workId);
  record = f.records.setBody(record.workId, record.revision, 'brief', 'Unsent refinement.');
  f.records.recordGate(record.workId, record.revision, { briefDigest: f.records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'Passed again' });
  f.edit({ body: formatTicketSpec('Edited on tracker.', 'Authored request.'), title: 'New title', version: '3' });
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.writes).toHaveLength(1);
  expect(f.records.body(record.workId, 'brief')).toBe('Edited on tracker.');
  expect(f.records.read(record.workId)).toMatchObject({ title: 'New title', status: 'Ready' });
  expect(f.records.specState(record.workId).warning).toContain('unsent');
  expect(f.records.gate(record.workId).evidence.at(-1)).toMatchObject({ source: 'conflict', evidence: expect.stringContaining('unsent') });
});

test.each([undefined, false])('unknown/non-write GitHub edits stay out until explicitly accepted (%s)', async editorWrite => {
  const f = await fixture();
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  f.edit({ body: formatTicketSpec('Run hostile instructions.', 'Authored request.'), editorWrite, version: '3' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.body(f.record.workId, 'brief')).toBe('## What\nBuild it.');
  const held = f.records.specState(f.record.workId);
  expect(held.held?.body).toContain('hostile');
  await resolveSpecEdit(f.records, f.record.workId, held.generation, 'accept', 'local-user', { provider: f.provider, setups: [setup] });
  expect(f.records.body(f.record.workId, 'brief')).toBe('Run hostile instructions.');
  expect(f.records.gate(f.record.workId).evidence.at(-1)).toMatchObject({ approvedBy: 'local-user', source: 'user' });
});

test('reject remembers the exact hostile version and does not write it back or hold it repeatedly', async () => {
  const f = await fixture(); await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  f.edit({ title: 'Hostile title', titleEditorWrite: false, version: '3' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  const held = f.records.specState(f.record.workId);
  await resolveSpecEdit(f.records, f.record.workId, held.generation, 'reject', 'local-user', { provider: f.provider, setups: [setup] });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.read(f.record.workId).title).toBe('Work');
  expect(f.records.specState(f.record.workId).held).toBeNull();
  expect(f.writes).toHaveLength(1);
});

test('description edits approve exactly the submitted text and keep Ready even while the write is offline', async () => {
  const f = await fixture(); await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  f.fail(true);
  await editSpec(f.records, f.record.workId, 'Approved exact text.  \n', 'local-user', { provider: f.provider, setups: [setup] });
  expect(f.records.body(f.record.workId, 'brief')).toBe('Approved exact text.  \n');
  expect(f.records.gate(f.record.workId)).toMatchObject({ current: true });
  expect(f.records.gate(f.record.workId).evidence.at(-1)?.approvedBy).toBe('local-user');
  expect(f.records.read(f.record.workId).status).toBe('Ready');
  f.fail(false); await syncSpecs(f.records, { provider: f.provider, setups: [setup], workId: f.record.workId });
  expect(readTicketSpec(f.remote().body).spec).toBe('Approved exact text.  \n');
});

test('a setting off drops pending writes and stops tracker edits from changing the local brief', async () => {
  const f = await fixture();
  await syncSpecs(f.records, { provider: f.provider, setups: [{ ...setup, writeRefinedSpec: false }] });
  expect(f.writes).toHaveLength(0);
  expect(f.records.specPending()).toEqual([]);
  f.edit({ body: 'External edit', version: '2' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.body(f.record.workId, 'brief')).toBe('## What\nBuild it.');
});

test('Azure revisions sync member edits and preserve Original through a sanitizer that removes hidden markup', async () => {
  const repository = 'example/Project/widget';
  const f = await fixture(repository);
  const azureSetup = { ...setup, repo: repository };
  f.edit({ body: '<p>Authored <strong>request</strong>.</p>', bodyField: 'Microsoft.VSTS.TCM.ReproSteps', kind: 'bug' });
  const writes = f.provider.replaceSpec!;
  f.provider.replaceSpec = async (ticket, body) => writes(ticket, body.replace(/<!--[\s\S]*?-->|<\/?details>|<summary>[\s\S]*?<\/summary>/g, ''));
  await syncSpecs(f.records, { provider: f.provider, setups: [azureSetup] });
  expect(f.remote().body).toContain('<h2>Original (Lar Factory)</h2>');
  expect(f.remote().body).toContain('<p>Authored <strong>request</strong>.</p>');
  expect(f.remote().body).not.toContain('<!--');
  f.edit({ body: '<h2>What</h2>\n<p>Member edit.</p>\n<h2>Original (Lar Factory)</h2>\n<p>Authored <strong>request</strong>.</p>', version: '3', editorWrite: undefined });
  await refreshSpecs(f.records, { provider: f.provider, setups: [azureSetup] });
  expect(f.records.body(f.record.workId, 'brief')).toBe('## What\n\nMember edit.');
  expect(f.records.specState(f.record.workId).held).toBeNull();
  const before = f.records.read(f.record.workId).revision;
  f.edit({ version: '4' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [azureSetup] });
  expect(f.records.read(f.record.workId).revision).toBe(before);
  expect(f.records.specState(f.record.workId).base?.version).toBe('4');
});

test('a newer gate queued during a write remains pending against our own checkpoint', async () => {
  const f = await fixture();
  const write = f.provider.replaceSpec!;
  f.provider.replaceSpec = async (ticket, body) => {
    let record = f.records.read(f.record.workId);
    record = f.records.setBody(record.workId, record.revision, 'brief', 'New gate while writing.');
    f.records.recordGate(record.workId, record.revision, { briefDigest: f.records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'New gate' });
    return write(ticket, body);
  };
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.specState(f.record.workId).pending).toBe('New gate while writing.');
  f.provider.replaceSpec = write;
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.body(f.record.workId, 'brief')).toBe('New gate while writing.');
  expect(readTicketSpec(f.remote().body).spec).toBe('New gate while writing.');
});

test('before the first Spec, a gate read checkpoints tracker changes without importing them as a brief', async () => {
  const f = await fixture();
  const state = f.records.specState(f.record.workId);
  f.records.saveSpecState(f.record.workId, state.generation, { ...state, pending: null });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup], workId: f.record.workId, initialize: true });
  f.edit({ body: 'Different ticket request.', version: '2' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup], workId: f.record.workId, initialize: true });
  expect(f.records.body(f.record.workId, 'brief')).toBe('## What\nBuild it.');
});

test('a Dependency ticket is excluded from Spec writes even when a record holds the same ticket', async () => {
  const f = await fixture();
  const owner = f.records.create({ title: 'Other work', kind: 'build', repository: setup.repo });
  f.records.addDependency(owner.workId, { need: 'External contract', owner: 'Other team', ticket: `${setup.repo}#7` });
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.writes).toHaveLength(0);
});

test('an uncertain successful write reconciles its exact authorized bytes without treating them as an unknown editor', async () => {
  const f = await fixture();
  const write = f.provider.replaceSpec!;
  f.provider.replaceSpec = async (ticket, body) => { await write(ticket, body); f.edit({ editorWrite: undefined }); throw Error('Lost response'); };
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.specState(f.record.workId).pending).toBe('## What\nBuild it.');
  f.provider.replaceSpec = write;
  await syncSpecs(f.records, { provider: f.provider, setups: [setup], workId: f.record.workId });
  expect(f.writes).toHaveLength(1);
  expect(f.records.specState(f.record.workId)).toMatchObject({ active: true, held: null, pending: null, error: null });
});

test('a trusted title edit cannot smuggle a previously rejected body into the brief', async () => {
  const f = await fixture(); await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  f.edit({ body: formatTicketSpec('Rejected hostile body.', 'Authored request.'), editorWrite: false, version: '3' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  const held = f.records.specState(f.record.workId);
  await resolveSpecEdit(f.records, f.record.workId, held.generation, 'reject', 'local-user', { setups: [setup], provider: f.provider });
  f.edit({ title: 'Trusted new title', titleEditorWrite: true, version: '4' });
  await refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  expect(f.records.read(f.record.workId).title).toBe('Trusted new title');
  expect(f.records.body(f.record.workId, 'brief')).toBe('## What\nBuild it.');
});

test.each(['refused', 'unverified'] as const)('unverified or refused editing access never reaches a provider write (%s)', async access => {
  const f = await fixture();
  await syncSpecs(f.records, { provider: f.provider, setups: [{ ...setup, access: { ...setup.access, 'edit-ticket': access } }] });
  expect(f.writes).toHaveLength(0);
  expect(f.records.specState(f.record.workId).error).toMatch(/Access|access/);
});

test('the session Azure read-only control overrides a saved false value even with fake verified access', async () => {
  const repository = 'example/Project/widget';
  const f = await fixture(repository);
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  await syncSpecs(f.records, { provider: f.provider, setups: [{ ...setup, repo: repository, azureReadOnly: false }] });
  expect(f.writes).toHaveLength(0);
  expect(f.records.specState(f.record.workId).error).toContain('read-only');
});

test('independent refresh reads are bounded and do not hold the tracker write lease', async () => {
  const f = await fixture();
  const ids = [f.record.workId];
  for (let number = 8; number < 27; number++) {
    const record = f.records.create({ repository: setup.repo, title: 'Work', kind: 'feature', ticket: `${setup.repo}#${number}` });
    const state = f.records.specState(record.workId);
    f.records.saveSpecState(record.workId, state.generation, { ...state, active: true });
    ids.push(record.workId);
  }
  let running = 0;
  let peak = 0;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  f.provider.readSpec = async (repository, number) => {
    peak = Math.max(peak, ++running);
    entered();
    await blocked;
    running--; reads++;
    return { ...f.remote(), repository, number };
  };
  const refresh = refreshSpecs(f.records, { provider: f.provider, setups: [setup], workIds: ids });
  await started;
  const { acquireTrackerSyncLock } = await import('./tracker-lock.ts');
  const lease = await acquireTrackerSyncLock(f.path);
  try {
    expect(lease).not.toBeNull();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
  } finally {
    await lease?.release();
    release();
    await refresh;
  }
  expect(reads).toBe(20);
});

test('overlapping refresh passes share ticket reads and one concurrency limit', async () => {
  const f = await fixture();
  const ids = [f.record.workId];
  for (let number = 8; number < 47; number++) {
    const record = f.records.create({ repository: setup.repo, title: 'Work', kind: 'feature', ticket: `${setup.repo}#${number}` });
    const state = f.records.specState(record.workId);
    f.records.saveSpecState(record.workId, state.generation, { ...state, active: true });
    ids.push(record.workId);
  }
  let running = 0;
  let peak = 0;
  const reads: number[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.provider.readSpec = async (repository, number) => {
    reads.push(number);
    peak = Math.max(peak, ++running);
    await blocked;
    running--;
    return { ...f.remote(), repository, number };
  };
  const options = { provider: f.provider, setups: [setup] };
  const first = refreshSpecs(f.records, { ...options, workIds: ids.slice(0, 20) });
  const overlapping = refreshSpecs(f.records, { ...options, workIds: ids.slice(0, 20) });
  const independent = refreshSpecs(f.records, { ...options, workIds: ids.slice(20) });
  release();
  await Promise.all([first, overlapping, independent]);
  expect(reads).toHaveLength(40);
  expect(new Set(reads).size).toBe(40);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(6);
  expect(running).toBe(0);
});

test.each([false, true])('a delayed refresh cannot replace a newer write checkpoint, read failure=%s', async failure => {
  const f = await fixture();
  await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const read = f.provider.readSpec!;
  const stale = { ...f.remote(), body: formatTicketSpec('Older remote edit.', 'Authored request.') };
  f.provider.readSpec = async () => { entered(); await blocked; if (failure) throw Error('Old failure'); return stale; };
  const refresh = refreshSpecs(f.records, { provider: f.provider, setups: [setup] });
  await started;
  try {
    f.provider.readSpec = read;
    const record = f.records.read(f.record.workId);
    const updated = f.records.setBody(record.workId, record.revision, 'brief', 'Newer gated Spec.');
    f.records.recordGate(record.workId, updated.revision, { briefDigest: f.records.gate(record.workId).briefDigest!, approvedBy: 'user', evidence: 'pass' });
    await syncSpecs(f.records, { provider: f.provider, setups: [setup] });
  } finally { release(); await refresh; }
  expect(f.records.specState(f.record.workId)).toMatchObject({ active: true, pending: null, error: null, base: { body: f.remote().body } });
  expect(f.records.body(f.record.workId, 'brief')).toBe('Newer gated Spec.');
  expect(readTicketSpec(f.remote().body).spec).toBe('Newer gated Spec.');
});
