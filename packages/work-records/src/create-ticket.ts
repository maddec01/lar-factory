// Shared durable create path for Add item, local conversion and retro captures.
import { readTicketSpec, formatTicketSpec, validateDraft, effectiveIssueSettings, writeAccessProblem, onAzure, sameLabel, trackerCapabilities, type TicketCreationOptions, type ItemDraft, type RepoConfig, type TrackerLabels, type VocabularyKey } from '@lar-factory/shared';
import { discoverTicketOptions } from '@lar-factory/shared/publication-settings';
import { trackerLabels } from '@lar-factory/shared/tracker-labels';
import { WORK_KINDS, WorkRecordError, type WorkKind, type WorkRecords } from './work-records.ts';
import { refreshSpecs, rememberCreatedSpec } from './spec-sync.ts';
import { structureProvider, type StructureProvider } from './tracker-sync.ts';

type TicketDraft = Omit<ItemDraft, 'kind'> & { kind: WorkKind };

interface CaptureReply { status: number; body: { record?: import('./work-records.ts').WorkRecord; error: string | null; uncertain?: boolean } }
const reply = (status: number, body: CaptureReply['body']): CaptureReply => ({ status, body });
const failed = (err: unknown) => reply(err instanceof WorkRecordError && ['ticket-taken', 'stale-revision', 'not-found', 'invalid'].includes(err.code) ? 409 : 502, { error: (err as Error).message });
const REQUEST_ID = /^[a-f0-9-]{36}$/;
const isTicketNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
export interface TicketCaptureDeps {
  records: WorkRecords;
  repos(): RepoConfig[];
  provider?: StructureProvider;
  discoverOptions?: (repo: RepoConfig) => Promise<TicketCreationOptions>;
  labels?: (repo: string) => TrackerLabels;
}

export async function captureWork(input: Record<string, unknown>, { records, repos, provider = structureProvider(), discoverOptions = discoverTicketOptions, labels = trackerLabels }: TicketCaptureDeps,
  target?: { workId: string; revision: number }): Promise<CaptureReply> {
  const repoOf = (value: unknown) => repos().find(repo => repo.repo === value);
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
    return reply(400, { error: 'The submission needs a valid request ID.' });
  }
  let draft: TicketDraft;
  try { draft = target ? validateDraft(input.draft, repos(), WORK_KINDS) : validateDraft(input.draft, repos()); }
  catch (err) { return reply(422, { error: (err as Error).message }); }
  // Conversion sends the stored title exactly as previewed, including authored spacing.
  if (target) draft.title = (input.draft as TicketDraft).title;
  const repo = repoOf(draft.repo)!;
  draft.createIssue ??= repo.setup ? effectiveIssueSettings(repo.setup).createIssuesFromAddItem : false;
  let claim;
  try { claim = records.claimCapture(input.requestId, JSON.stringify(target ? { draft, target } : draft), target?.workId); }
  catch (err) { return reply(409, { error: (err as Error).message }); }
  const { fresh, submission } = claim;
  const body = `${draft.description}\n\n<!-- lar-factory:create {"identity":"${input.requestId}"} -->`;
  let createdTicket = submission.createdTicket ?? undefined;
  const finishSpec = async (workId: string) => {
    if (target && readTicketSpec(draft.description).marked) {
      if (!records.specState(workId).active) {
        // A lost create response has no provider checkpoint. Compare against the exact authorized submission instead.
        rememberCreatedSpec(records, workId, createdTicket ?? { repository: draft.repo, number: Number(records.read(workId).ticket!.split('#').at(-1)),
          title: draft.title, body, version: '' });
      }
      if (!fresh) await refreshSpecs(records, { workId, provider, setups: repos().flatMap(repo => repo.setup ? [repo.setup] : []) });
    }
    return records.read(workId);
  };
  if (submission.workId) {
    try {
      const record = await finishSpec(submission.workId);
      return reply(200, { record, error: null });
    } catch (err) { return failed(err); }
  }
  if (submission.failure) return reply(502, { error: submission.failure });
  if (!draft.createIssue) {
    try {
      const { record } = records.completeCapture(input.requestId, { title: draft.title, context: draft.description, repository: draft.repo, kind: draft.kind });
      return reply(200, { record, error: null });
    } catch (err) { return failed(err); }
  }
  const uncertain = (extra = '') => reply(409, { uncertain: true, error: `The issue creation outcome is uncertain. This submission cannot create another issue. Check the board and use Find a ticket to recover it.${extra}` });
  let number = submission.ticket ? Number(submission.ticket.slice(submission.ticket.lastIndexOf('#') + 1)) : undefined;
  if (!number && !fresh) {
    try {
      const matches = (await provider.find(draft.repo, input.requestId)).filter(ticket => ticket.body.includes(`<!-- lar-factory:create {"identity":"${input.requestId}"} -->`));
      if (matches.length !== 1) return uncertain(onAzure(draft.repo) ? ' Azure may have stripped its hidden marker.' : '');
      number = matches[0]!.number;
      if (!isTicketNumber(number)) return uncertain();
    } catch { return uncertain(); }
  }
  if (!number) {
    const access = repo.setup?.access ?? {};
    const problem = writeAccessProblem(draft.repo, 'publish-ticket', access, { azureReadOnly: repo.setup?.azureReadOnly });
    if (problem) { records.failCapture(input.requestId, problem); return reply(403, { error: problem }); }
    const mapping = repo.setup?.vocabulary[draft.kind as VocabularyKey];
    const { newLabels = [], ...options } = draft.options ?? {};
    const safety = { azureReadOnly: repo.setup?.azureReadOnly };
    /** Why the typed names can't go on this ticket. They are never dropped quietly, as hidden fields are below. */
    const newLabelRefusal = (setup: RepoConfig['setup']) => {
      if (!newLabels.length) return null;
      const safety = { azureReadOnly: setup?.azureReadOnly };
      return writeAccessProblem(draft.repo, 'tag-ticket', setup?.access ?? {}, safety) ?? writeAccessProblem(draft.repo, 'manage-labels', setup?.access ?? {}, safety);
    };
    const refusal = newLabelRefusal(repo.setup);
    if (refusal) { records.failCapture(input.requestId, refusal); return reply(403, { error: refusal }); }
    const toCreate: string[] = [];
    const labelsAllowed = !writeAccessProblem(draft.repo, 'tag-ticket', access, safety);
    const typesAllowed = !writeAccessProblem(draft.repo, 'type-ticket', access, safety);
    options.labels = labelsAllowed ? options.labels ?? mapping?.labels ?? [] : [];
    options.type = typesAllowed ? options.type ?? mapping?.type ?? undefined : undefined;
    // Recheck capabilities at the server. Hidden or unavailable fields never leak mappings into a write.
    try {
      const available = await discoverOptions(repo);
      options.labels = options.labels.filter(label => available.labels.includes(label));
      for (const name of newLabels) {
        const existing = available.labels.find(label => sameLabel(label, name));
        if (existing) options.labels = [...new Set([...options.labels, existing])];
        else if (!toCreate.some(label => sameLabel(label, name))) toCreate.push(name);
      }
      if (!available.types.includes(options.type ?? '')) options.type = undefined;
      if (!available.assignees.includes(options.assignee ?? '')) delete options.assignee;
      if (!available.milestones.some(m => m.value === options.milestone)) delete options.milestone;
      if (!available.iterations.includes(options.iteration ?? '')) delete options.iteration;
    } catch (err) {
      if (newLabels.length) {
        const error = `Could not read the tracker's labels to add ${newLabels.join(', ')}. ${(err as Error).message}`;
        records.failCapture(input.requestId, error);
        return reply(502, { error });
      }
      options.labels = [];
      options.type = undefined;
      delete options.assignee;
      delete options.milestone;
      delete options.iteration;
    }
    let areaPath: string | undefined;
    let backlogType: string | undefined;
    try {
      if (onAzure(draft.repo)) {
        const team = repo.team ?? (repo.setup?.itemSource?.kind === 'azure-board' ? repo.setup.itemSource.team : undefined);
        if (!team || !provider.creationTarget) throw Error('The Azure team has no readable backlog type or default area. Check its list source.');
        const target = await provider.creationTarget(draft.repo, team);
        backlogType = target.type;
        options.type ||= target.type;
        areaPath = target.areaPath;
      } else if (options.iteration) throw Error('GitHub does not support an iteration option.');
      if (onAzure(draft.repo) && options.milestone) throw Error('Azure does not support a milestone option.');
    } catch (err) {
      records.failCapture(input.requestId, (err as Error).message);
      return failed(err);
    }
    try {
      const latest = repoOf(draft.repo)?.setup;
      const safety = { azureReadOnly: latest?.azureReadOnly };
      const problem = writeAccessProblem(draft.repo, 'publish-ticket', latest?.access ?? {}, safety);
      if (problem) { records.failCapture(input.requestId, problem); return reply(403, { error: problem }); }
      if (writeAccessProblem(draft.repo, 'tag-ticket', latest?.access ?? {}, safety)) options.labels = [];
      if (writeAccessProblem(draft.repo, 'type-ticket', latest?.access ?? {}, safety)) options.type = backlogType;
      const refusal = newLabelRefusal(latest);
      if (refusal) { records.failCapture(input.requestId, refusal); return reply(403, { error: refusal }); }
      const { createUnavailable, noun } = trackerCapabilities(draft.repo);
      // A tracker with no create of its own makes the label from the ticket's write, which then fails or succeeds as one.
      for (const name of toCreate) {
        try { options.labels = [...options.labels ?? [], createUnavailable ? name : (await labels(draft.repo).create({ name })).name]; }
        catch (err) {
          const error = `Could not create the ${noun} ${name}, so no ticket was created. ${(err as Error).message}`;
          records.failCapture(input.requestId, error);
          return reply(502, { error });
        }
      }
      const ticket = await provider.create(draft.repo, draft.title, body, options.type, areaPath, options);
      createdTicket = ticket;
      number = ticket.number;
      if (!Number.isSafeInteger(number) || number <= 0) return uncertain();
    } catch (err) {
      // Only explicit provider refusals prove no ticket was created. Transport and server errors remain uncertain.
      if (/\b(?:400|401|403|404|422)\b/.test((err as Error).message)) {
        records.failCapture(input.requestId, (err as Error).message);
        return failed(err);
      }
      return uncertain();
    }
  }
  try {
    records.saveCaptureTicket(input.requestId, `${draft.repo}#${number}`, createdTicket);
    const { record } = records.completeCapture(input.requestId, { title: draft.title, context: draft.description,
      repository: draft.repo, kind: draft.kind, ticket: `${draft.repo}#${number}` }, target);
    return reply(200, { record: await finishSpec(record.workId), error: null });
  } catch {
    return reply(502, { uncertain: true, error: `Created ${draft.repo}#${number}, but could not save its record. Use Find a ticket to add it. This submission will not create another issue.` });
  }
}

/** Authoritative, noneditable outgoing text, computed from the current gate and settings. */
export function recordTicketPreview(records: WorkRecords, workId: string, repos: RepoConfig[]) {
  const record = records.read(workId);
  const repo = repos.find(repo => repo.repo === record.repository);
  if (!repo) throw new WorkRecordError('invalid', 'Choose a configured repository.');
  const description = records.initialContext(workId);
  const brief = record.kind !== 'concept' && record.kind !== 'decision' && records.gate(workId).current ? records.body(workId, 'brief') : null;
  const spec = repo.setup && effectiveIssueSettings(repo.setup).writeRefinedSpec && brief;
  return { title: record.title, description: spec ? formatTicketSpec(brief, description) : description, revision: record.revision };
}

/** Convert one existing record. Retro callers request only kind mappings and obey the retro setting. */
export async function createRecordTicket(workId: string, input: Record<string, unknown>, deps: TicketCaptureDeps): Promise<CaptureReply> {
  const { records } = deps;
  const record = records.read(workId);
  const repo = deps.repos().find(repo => repo.repo === record.repository);
  if (!repo) return reply(422, { error: 'Choose a configured repository.' });
  if (input.retro === true && record.kind === 'concept') return reply(409, { error: 'Concept captures use structure sync.' });
  // A disabled retro preference is a successful local capture. Access refusals are reported as failures.
  if (input.retro === true && repo.setup?.createIssuesFromRetro === false) return reply(200, { record, error: null });
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) return reply(400, { error: 'The submission needs a valid request ID.' });
  const prior = records.captureSubmission(input.requestId);
  if (prior) {
    if (prior.draft === '') return reply(409, { error: 'This submission expired. It cannot create another item or issue.' });
    const saved = JSON.parse(prior.draft) as { draft: TicketDraft; target?: { workId: string; revision: number } };
    if (saved.target?.workId !== workId) return reply(409, { error: 'This submission belongs to another item.' });
    return captureWork({ requestId: input.requestId, draft: saved.draft }, deps, saved.target);
  }
  if (record.ticket) return reply(409, { error: 'This item already has a ticket.' });
  if (input.revision !== record.revision) return reply(409, { error: 'The item changed. Reopen Create issue to preview its current text.' });
  const preview = recordTicketPreview(records, workId, deps.repos());
  if (input.preview !== undefined && JSON.stringify(input.preview) !== JSON.stringify(preview)) return reply(409, { error: 'The item text or settings changed. Reopen Create issue to preview its current text.' });
  const draft = { repo: record.repository, kind: record.kind, title: preview.title,
    description: input.retro === true ? records.initialContext(workId) : preview.description, createIssue: true,
    ...(input.retro === true ? {} : { options: input.options }) };
  return captureWork({ requestId: input.requestId, draft }, deps, { workId, revision: record.revision });
}
