// One durable Spec drain, also used by gate/build reads and description editing.
import { createHash } from 'node:crypto';
import TurndownService from 'turndown';
import { formatTicketSpec, readTicketSpec, readTrackerStructure, stripTrackerStructure, writeTrackerStructure, sameRepo, writeAccessProblem, type RepositorySetup } from '@lar-factory/shared';
import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import type { WorkRecords } from './work-records.ts';
import type { SpecRemote, SpecState } from './spec-records.ts';
import { structureProvider, type StructureProvider, type StructureTicket } from './tracker-sync.ts';
import { acquireTrackerSyncLock } from './tracker-lock.ts';

export interface SpecSyncOptions { provider?: StructureProvider; setups?: RepositorySetup[]; dir?: string; workId?: string; workIds?: readonly string[]; initialize?: boolean }
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const markdown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
const azure = (repository: string) => repository.split('/').length !== 2;
const toMarkdown = (text: string, repository: string) => azure(repository) && /<\/?[a-z][^>]*>/i.test(text) ? markdown.turndown(text) : text;
const checkpoint = (ticket: StructureTicket): SpecRemote => ({ body: ticket.body, title: ticket.title ?? '', version: ticket.version,
  digest: sha(JSON.stringify([stripTrackerStructure(ticket.body), ticket.title ?? ''])), editorWrite: ticket.editorWrite, titleEditorWrite: ticket.titleEditorWrite });
const changed = (repository: string, base: SpecRemote, remote: SpecRemote) => azure(repository) ? remote.version !== base.version : remote.digest !== base.digest;
function content(ticket: Pick<StructureTicket, 'body'>) { return readTicketSpec(stripTrackerStructure(ticket.body).replace(/<!-- lar-factory:create [^\n]*? -->/g, '').trimEnd()); }
function outgoing(ticket: StructureTicket, spec: string, savedOriginal?: string): string {
  const parsed = content(ticket);
  let body: string;
  if (azure(ticket.repository)) {
    // Preserve Original's existing HTML exactly. A visible heading survives sanitizers that remove comments/details.
    const original = parsed.original ?? savedOriginal ?? stripTrackerStructure(ticket.body);
    body = formatTicketSpec(spec, original, { format: 'html', originalFormat: 'html' });
  } else body = formatTicketSpec(spec, parsed.original ?? savedOriginal ?? stripTrackerStructure(ticket.body));
  const structure = readTrackerStructure(ticket.body);
  return structure ? writeTrackerStructure(body, structure) : body;
}
function allowed(setup: RepositorySetup | undefined): setup is RepositorySetup { return Boolean(setup && setup.writeRefinedSpec !== false); }
function save(records: WorkRecords, workId: string, state: SpecState, update?: Parameters<WorkRecords['saveSpecState']>[3]) {
  return records.saveSpecState(workId, state.generation, state, update);
}
const reading = new WeakMap<WorkRecords, Map<string, Promise<StructureTicket | null>>>();
let activeReads = 0;
const waitingReads: (() => void)[] = [];
async function limitedRead(read: () => Promise<StructureTicket>): Promise<StructureTicket> {
  if (activeReads >= 6) await new Promise<void>(resolve => { waitingReads.push(resolve); });
  else activeReads++;
  try { return await read(); }
  finally {
    const next = waitingReads.shift();
    if (next) next();
    else activeReads--;
  }
}
function readOne(records: WorkRecords, workId: string, options: SpecSyncOptions, provider: StructureProvider): Promise<StructureTicket | null> {
  let reads = reading.get(records);
  if (!reads) { reads = new Map(); reading.set(records, reads); }
  // Different generations must not share a result computed against an older provenance checkpoint.
  const key = `${workId}:${records.specState(workId).generation}:${Boolean(options.initialize)}`;
  const prior = reads.get(key);
  if (prior) return prior;
  const task = readFresh(records, workId, options, provider).finally(() => reads.delete(key));
  reads.set(key, task);
  return task;
}
async function readFresh(records: WorkRecords, workId: string, options: SpecSyncOptions, provider: StructureProvider): Promise<StructureTicket | null> {
  if (!records.specEligible(workId)) return null;
  const record = records.read(workId);
  const setup = (options.setups ?? readRepositorySetups(options.dir ?? boardDataDir())).find(setup => sameRepo(setup.repo, record.repository));
  if (!allowed(setup)) return null;
  const before = records.specState(workId);
  if (!before.active && before.pending === null && !options.initialize) return null;
  try {
    if (!provider.readSpec) throw Error('The provider cannot read ticket Specs.');
    const ticket = await limitedRead(() => provider.readSpec!(record.repository, Number(record.ticket!.split('#').at(-1)), before.held ?? before.base ?? undefined));
    const remote = checkpoint(ticket);
    if (records.specState(workId).generation !== before.generation) return null;
    if (!before.base || !before.active && before.pending === null) {
      save(records, workId, { ...before, base: remote, original: !before.active && before.pending === null ? content(ticket).original ?? stripTrackerStructure(ticket.body) : before.original ?? content(ticket).original ?? stripTrackerStructure(ticket.body), error: before.failure === 'write' ? before.error : null, warning: null });
      return ticket;
    }
    if (before.sent && stripTrackerStructure(remote.body) === stripTrackerStructure(before.sent.body) && remote.title === before.sent.title) {
      save(records, workId, { ...before, active: true, base: remote, original: content(ticket).original ?? before.original,
        sent: undefined, pending: before.pending === before.sent.spec ? null : before.pending, error: null, warning: null });
      return ticket;
    }
    if (!changed(record.repository, before.base, remote)) {
      if (before.failure === 'read' && before.error || before.warning?.startsWith('Could not read')) save(records, workId, { ...before, error: null, warning: null });
      return ticket;
    }
    // Azure revisions unrelated to title/description update the checkpoint without converting HTML again.
    if (before.base.digest === remote.digest) {
      save(records, workId, { ...before, base: remote, error: before.failure === 'write' ? before.error : null }); return ticket;
    }
    const bodyChanged = content(remote).spec !== content(before.base).spec;
    const titleChanged = remote.title !== before.base.title;
    if (!bodyChanged && !titleChanged) {
      save(records, workId, { ...before, base: remote, original: content(remote).original ?? before.original });
      return ticket;
    }
    const untrusted = !azure(record.repository) && (
      bodyChanged && remote.editorWrite !== true || titleChanged && remote.titleEditorWrite !== true);
    if (untrusted) {
      if (before.held?.digest === remote.digest) return null;
      save(records, workId, { ...before, held: remote, error: null, warning: 'A GitHub edit has unknown or non-write provenance. Accept or reject it before using its text.' });
      return null;
    }
    const replaced = before.pending !== null && bodyChanged;
    save(records, workId, { ...before, sent: undefined, active: true, pending: bodyChanged ? null : before.pending, base: remote, held: null, error: null,
      warning: replaced ? 'The ticket changed. Its text replaced your unsent Spec.' : null }, {
      text: bodyChanged ? toMarkdown(content(ticket).spec, record.repository) : records.body(workId, 'brief') ?? '', title: titleChanged ? ticket.title : record.title, source: replaced ? 'conflict' : 'tracker', identity: 'tracker',
      evidence: replaced ? `The ticket won a concurrent edit; the unsent Spec was replaced.\n\nUnsent Spec:\n${before.pending}` : 'The title and Spec came from the tracker.',
    });
    return ticket;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    save(records, workId, { ...before, error: reason, failure: 'read', retryAfter: Date.now() + 30_000, warning: `Could not read the ticket. Using the last local copy: ${reason}` });
    return null;
  }
}

/** Reread before later gates/builds, and during board ticket refreshes. A failed read keeps the last copy. */
export async function refreshSpecs(records: WorkRecords, options: SpecSyncOptions = {}): Promise<void> {
  const provider = options.provider ?? structureProvider();
  const workIds = options.workId ? [options.workId] : options.workIds ?? records.list({}).filter(record => {
    const state = records.specState(record.workId);
    return state.active || state.pending !== null;
  }).map(record => record.workId);
  // Each read commits against its starting generation. Writes retain their cross-process lease.
  await Promise.all(workIds.map(workId => readOne(records, workId, options, provider)));
}
const running = new WeakMap<WorkRecords, Promise<void>>();
/** A failed write stays Ready and pending. The shared lease serializes spec and structure writes across processes. */
export function syncSpecs(records: WorkRecords, options: SpecSyncOptions = {}): Promise<void> {
  const prior = running.get(records); if (prior) return prior;
  const task = drain(records, options).finally(() => running.delete(records)); running.set(records, task); return task;
}
async function drain(records: WorkRecords, options: SpecSyncOptions) {
  const lease = await acquireTrackerSyncLock(records.trackerDatabasePath()); if (!lease) return;
  try {
    const provider = options.provider ?? structureProvider();
    const setups = options.setups ?? readRepositorySetups(options.dir ?? boardDataDir());
    for (const workId of options.workId ? [options.workId] : records.specPending()) {
      if (!records.specEligible(workId)) continue;
      let state = records.specState(workId); if (state.pending === null || state.held || !options.workId && (state.retryAfter ?? 0) > Date.now()) continue;
      const record = records.read(workId);
      const setup = setups.find(setup => sameRepo(setup.repo, record.repository));
      if (setup?.writeRefinedSpec === false) { save(records, workId, { ...state, pending: null, error: null }); continue; }
      try {
        if (!setup) throw Error('Add the repository before syncing its Spec.');
        const problem = writeAccessProblem(record.repository, 'edit-ticket', setup.access, { azureReadOnly: setup.azureReadOnly || process.env.LAR_FACTORY_AZURE_READ_ONLY === '1' });
        if (problem) throw Error(problem);
        await lease.assertOwned();
        const ticket = await readOne(records, workId, { ...options, setups }, provider);
        state = records.specState(workId);
        if (!ticket || state.pending === null || state.held) continue;
        if (records.body(workId, 'brief') !== state.pending) { save(records, workId, { ...state, pending: null, warning: 'The local brief changed after its gate. Gate the new text to sync it.' }); continue; }
        if (!provider.replaceSpec) throw Error('The provider cannot write ticket Specs.');
        const body = outgoing(ticket, state.pending, state.original);
        await lease.assertOwned();
        if (records.specState(workId).generation !== state.generation) continue;
        if (!save(records, workId, { ...state, sent: { body, title: ticket.title ?? '', spec: state.pending } })) continue;
        state = records.specState(workId);
        const written = await provider.replaceSpec(ticket, body);
        await lease.assertOwned();
        // The provider result checkpoints exactly our write; a subsequent edit is found by the next read.
        const latest = records.specState(workId);
        const original = content(written).original ?? state.original ?? content(ticket).original ?? stripTrackerStructure(ticket.body);
        if (latest.generation === state.generation) save(records, workId, { ...state, active: true, pending: null, sent: undefined, original, base: checkpoint(written), error: null, warning: null });
        else if (latest.ticket === state.ticket && latest.base?.digest === state.base?.digest) {
          // A newer gate queued while our authorized write was in flight. It remains pending against our own write.
          save(records, workId, { ...latest, active: true, pending: latest.pending === state.sent?.spec ? null : latest.pending, sent: undefined, original, base: checkpoint(written) });
        }
      } catch (error) {
        const latest = records.specState(workId);
        if (latest.generation === state.generation) {
          const message = error instanceof Error ? error.message : String(error);
          save(records, workId, { ...state, error: message, failure: 'write', retryAfter: Date.now() + 30_000 });
          if (/ticket changed before|TF26071|\b412\b/i.test(message)) await readOne(records, workId, { ...options, setups }, provider);
        }
      }
    }
  } finally { await lease.release(); }
}

/** The generation binds the user's choice to the exact held title and text shown in details. */
export async function resolveSpecEdit(records: WorkRecords, workId: string, generation: number, choice: 'accept' | 'reject', identity: string, options: SpecSyncOptions = {}): Promise<void> {
  const record = records.read(workId);
  const setup = (options.setups ?? readRepositorySetups(options.dir ?? boardDataDir())).find(setup => sameRepo(setup.repo, record.repository));
  if (!allowed(setup)) throw Error('Spec sync is off for this repository.');
  const state = records.specState(workId);
  if (state.generation !== generation || !state.held) throw Error('The held edit changed. Read the details again.');
  if (!['accept', 'reject'].includes(choice) || !identity.trim()) throw Error('Choose Accept or Reject and name the approving user.');
  const remote = state.held;
  const accepted = choice === 'accept';
  const next = { ...state, sent: undefined, active: accepted || state.active, base: remote, held: null, error: null, warning: accepted ? null : 'The GitHub edit was rejected. The last trusted local copy is kept.', ...(accepted ? { pending: null } : {}) };
  if (!save(records, workId, next, accepted ? { text: toMarkdown(readTicketSpec(stripTrackerStructure(remote.body)).spec, record.repository), title: remote.title,
    source: 'user', identity, evidence: 'The user accepted this exact held tracker title and Spec.' } : undefined)) throw Error('The held edit changed. Read the details again.');
}

/** A details Save is approval of these exact Markdown bytes; its durable write can finish after a restart. */
export async function editSpec(records: WorkRecords, workId: string, text: string, identity: string, options: SpecSyncOptions = {}): Promise<boolean> {
  if (!records.specEligible(workId)) return false;
  const record = records.read(workId);
  const setup = (options.setups ?? readRepositorySetups(options.dir ?? boardDataDir())).find(setup => sameRepo(setup.repo, record.repository));
  if (!allowed(setup)) return false;
  const current = records.specState(workId);
  if (!current.active && current.pending === null) return false;
  const problem = writeAccessProblem(record.repository, 'edit-ticket', setup.access, { azureReadOnly: setup.azureReadOnly || process.env.LAR_FACTORY_AZURE_READ_ONLY === '1' });
  if (problem) throw Error(problem);
  if (!identity.trim()) throw Error('The approving user is required.');
  await refreshSpecs(records, { ...options, workId });
  const state = records.specState(workId);
  if (state.held) throw Error('Accept or reject the held GitHub edit before editing the Spec.');
  if (!save(records, workId, { ...state, pending: text, error: null }, { text, source: 'user', identity, evidence: 'The user saved and approved this exact Spec in item details.' })) throw Error('The Spec changed. Read the details again.');
  await syncSpecs(records, { ...options, workId });
  return true;
}

/** Only already-synced, enabled Specs replace the details' ordinary tracker view. */
export function activeSpecState(records: WorkRecords, workId: string, options: SpecSyncOptions = {}): SpecState | null {
  if (!records.specEligible(workId)) return null;
  const state = records.specState(workId); if (!state.active && state.pending === null) return null;
  const record = records.read(workId);
  const setup = (options.setups ?? readRepositorySetups(options.dir ?? boardDataDir())).find(setup => sameRepo(setup.repo, record.repository));
  return allowed(setup) ? state : null;
}

/** A successful local conversion already wrote a gated Spec through the shared create machinery. */
export function rememberCreatedSpec(records: WorkRecords, workId: string, ticket: StructureTicket): void {
  const state = records.specState(workId);
  const parsed = content(ticket);
  if (parsed.marked) save(records, workId, { ...state, active: true, base: checkpoint(ticket), original: parsed.original ?? undefined });
}
