import { isRecord, publicationConsents, type PublicationBoardState, type PublicationPlan } from '@lar-factory/shared';
import { WorkRecordError, type WorkRecords } from '@lar-factory/work-records';
import { PublicationConflict, publicationEngine, type PreparePublication, type PublicationDependencies, type ReconciliationSelection } from '@lar-factory/work-records/publication';
import type { PublicationSettings } from '@lar-factory/shared/publication-settings';

const invalid = (message: string): never => { throw new WorkRecordError('invalid', message); };

/** The journal owns plans and outcomes. This module adds board access checks and request concurrency only. */
export function createPublication(records: WorkRecords | null, options: PublicationDependencies & {
  allowed: (repository: string) => boolean;
  settings: (repository: string) => Promise<PublicationSettings>;
  changed?: () => void;
}) {
  const engine = records ? publicationEngine(records, options) : null;
  const running = new Set<string>();
  function attachReceipts(plan: PublicationPlan) {
    let changed = false;
    for (const result of plan.results) {
      if (result.operation.kind !== 'create' || result.status !== 'successful' || !result.attempt?.ticket || !result.attempt.url) continue;
      const ticketWorkId = result.operation.ticketWorkId;
      if (records!.publicationAttachment(ticketWorkId)) continue;
      records!.attachPublicationUrl(ticketWorkId, records!.read(ticketWorkId).revision, plan.planId, result.attempt.ticket, result.attempt.url);
      changed = true;
    }
    if (changed) options.changed?.();
  }
  async function read(workId: string): Promise<PublicationBoardState> {
    const plans = records!.publications(workId);
    const plan = plans.findLast((plan) => !plan.supersededBy);
    if (plan) attachReceipts(plan);
    const readiness = records!.publicationReadiness(workId);
    const sources = readiness.sources.filter((source) => records!.read(source.workId).kind !== 'decision').map((source) => {
      const record = records!.read(source.workId);
      return { workId: source.workId, revision: record.revision, title: record.title, repository: record.repository, kind: record.kind,
        body: records!.body(source.workId, record.kind === 'concept' ? 'map' : 'brief') ?? '' };
    });
    for (const source of sources) if (!options.allowed(source.repository)) invalid(`${source.repository} is not an onboarded publication destination.`);
    const settings = await Promise.all([...new Set(sources.map((source) => source.repository))].map(options.settings));
    let pending = plan ? await engine!.inspect(workId, plan.planId) : null;
    if (pending?.next) {
      const ticket = plan!.tickets.find((ticket) => ticket.workId === pending!.next!.ticketWorkId)!;
      const setup = settings.find((config) => config.setup.repo === ticket.destination.repository)!.setup;
      const reasons = publicationConsents(pending.next, ticket).filter((operation) => !setup.consent.includes(operation) || setup.access[operation] === 'refused')
        .map((operation) => `${setup.repo} needs separate consent and credential access for ${operation}.`);
      if (reasons.length) pending = { ...pending, current: false, next: null, reasons: [...pending.reasons, ...reasons] };
    }
    const publishedRepositories = new Set(records!.list({}).flatMap((record) => records!.publications(record.workId)).flatMap((plan) => plan.tickets.map((ticket) => ticket.destination.repository.toLowerCase())));
    return { readiness, sources, settings, firstUse: settings.some((config) => !publishedRepositories.has(config.setup.repo.toLowerCase())), pending };
  }
  return {
    async request(action: string, input: Record<string, unknown>): Promise<{ status: number; body: object }> {
      if (!records || !engine) return { status: 403, body: { error: 'Publication is unavailable in sample mode.' } };
      const { workId } = input;
      if (typeof workId !== 'string' || !workId) return { status: 400, body: { error: 'Name the work to publish.' } };
      if (running.has(workId)) return { status: 409, body: { error: 'A publication request is already running. Inspect its stored outcome before continuing.' } };
      running.add(workId);
      try {
        const record = records.read(workId);
        if (!options.allowed(record.repository)) invalid('That work is not in an onboarded repository.');
        if (record.kind === 'decision' || record.kind === 'slice') invalid('Decisions and slices cannot publish.');
        // Check every destination before any provider access, including a concept's other repositories.
        for (const source of records.publicationReadiness(workId).sources) if (!options.allowed(records.read(source.workId).repository)) invalid('A publication destination is not onboarded.');
        if (action === 'open') return { status: 200, body: await read(workId) };
        if (action === 'prepare') {
          const sources = records.publicationReadiness(workId).sources;
          const supplied = input.sources;
          if (!Array.isArray(supplied) || supplied.length !== sources.length || sources.some((source) => !supplied.some((value: unknown) =>
            isRecord(value) && value.workId === source.workId && value.revision === source.revision))) invalid('The refinement changed. Reopen publication and review the current sources.');
          const request: PreparePublication = { documents: input.documents as PreparePublication['documents'] };
          for (const key of ['typeSelections', 'replaces', 'delivery', 'resolutions'] as const) if (input[key] !== undefined) Object.assign(request, { [key]: input[key] });
          await engine.prepare(workId, request);
        } else {
          if (typeof input.planId !== 'string' || !input.planId) invalid('Name the stored publication plan.');
          const planId = input.planId as string;
          const plan = records.publication(workId, planId);
          if (plan.supersededBy) return { status: 409, body: { ...await read(workId), error: 'This publication changed. Review its replacement before approval.' } };
          if (action === 'approve' || action === 'resume') {
            if (input.revision !== plan.revision || input.digest !== plan.digest) return { status: 409, body: { ...await read(workId), error: 'The plan changed. Inspect and approve its exact preview again.' } };
            const inspected = await engine.inspect(workId, planId);
            const reasons = inspected.reasons.filter((reason) => reason !== 'The exact publication content needs approval.');
            if (reasons.length) return { status: 409, body: { ...await read(workId), error: reasons.join(' ') } };
            if (action === 'approve') records.approvePublication(workId, planId, plan.revision, plan.digest, 'board user');
            else if (!plan.approval) invalid('Approve the exact publication preview before continuing.');
            await engine.execute(workId, planId, 'board user');
          } else if (action === 'fallback') {
            if (input.delivery !== undefined && input.delivery !== 'comment' && input.delivery !== 'handover') invalid('Choose comment or handover fallback.');
            await engine.fallback(workId, planId, input.delivery as 'comment' | 'handover' | undefined);
          } else if (action === 'reconcile') {
            if (input.selections !== undefined && (!Array.isArray(input.selections) || input.selections.some((value) => !isRecord(value)
              || typeof value.operationId !== 'string' || (value.ticket !== undefined && typeof value.ticket !== 'string') || (value.commentId !== undefined && typeof value.commentId !== 'string')))) invalid('Send explicit recovery selections.');
            const reconciled = await engine.reconcile(workId, planId, 'board user', input.selections as ReconciliationSelection[] | undefined);
            return { status: 200, body: { ...await read(workId), candidates: reconciled.candidates } };
          } else if (action !== 'inspect') return { status: 404, body: { error: 'Unknown publication action.' } };
        }
        return { status: 200, body: await read(workId) };
      } catch (error) {
        return { status: error instanceof WorkRecordError ? error.code === 'not-found' ? 404 : 409 : 502, body: { error: error instanceof Error ? error.message : String(error), ...(error instanceof PublicationConflict ? { conflict: error.conflict } : {}) } };
      } finally { running.delete(workId); }
    },
  };
}
