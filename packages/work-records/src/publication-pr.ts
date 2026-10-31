// Delivery relationships share the publication journal, including uncertainty before dispatch.
import { randomUUID } from 'node:crypto';
import { decodePart, isRecord, onAzure, type PublicationContent, type PublicationPending, type PublicationPlan } from '@lar-factory/shared';
import { providerCommand } from '@lar-factory/shared/provider-command';
import { readPublicationSettings, type PublicationSettings } from '@lar-factory/shared/publication-settings';
import { type PublicationTransport, PublicationRefused } from './publication-providers.ts';
import { WorkRecordError, type WorkRecords } from './work-records.ts';

function invalid(message: string): never { throw new WorkRecordError('invalid', message); }
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const numberOf = (reference: string) => /#([1-9]\d*)$/.exec(reference)?.[1] ?? invalid('The reference needs a positive numeric ID.');

/** Generates PR text before creation, then journals verification or native linking after set-pr.
 * Azure linking preserves completionOptions, including transitionWorkItems, and never writes State.
 * GitHub's approved closing line is delivered in the PR body at creation; this module verifies it. */
export function publicationPr(records: WorkRecords, options: {
  dir?: string;
  settings?: (repository: string) => Promise<PublicationSettings>;
  transport?: PublicationTransport;
} = {}) {
  const settings = options.settings ?? ((repo: string) => readPublicationSettings(repo, { dir: options.dir }));
  const transport = options.transport ?? { github: (args: string[], input?: string) => providerCommand('gh', args, input), azure: (args: string[]) => providerCommand('az', args) };
  const target = (workId: string) => {
    const work = records.read(workId);
    if (['concept', 'decision', 'slice'].includes(work.kind)) invalid('Only a build has a delivery PR.');
    const saved = records.lastPublished(workId).filter((item) => item.operationKind !== 'textual-relationship').at(-1);
    const attached = records.publicationAttachment(workId);
    const ticket = work.ticket ?? attached?.ticket ?? saved?.ticket ?? null;
    if (ticket && !ticket.startsWith(`${work.repository}#`)) invalid('The ticket must belong to the build repository.');
    return { work, ticket };
  };
  const body = (workId: string, draft: string) => {
    if (typeof draft !== 'string' || !draft.trim()) invalid('Provide a complete PR body with outcome, decisions and reasons.');
    const { work, ticket } = target(workId);
    const closingReference = ticket && !onAzure(work.repository) ? `Closes ${ticket}` : null;
    return { body: closingReference && !draft.split('\n').includes(closingReference) ? `${draft.trimEnd()}\n\n${closingReference}\n` : draft, ticket, closingReference };
  };
  const scope = (repository: string) => {
    const [organization, project] = repository.split('/');
    return { project: decodePart(project!), flags: ['--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'] };
  };
  const checkSettings = (config: PublicationSettings, azure: boolean) => {
    if (!config.setup.itemSource || config.setup.paused.includes('itemSource') || config.setup.sharedProblem) invalid('Resolve the publication destination settings first.');
    if (azure && (!config.setup.consent.includes('relate-ticket') || config.setup.access['relate-ticket'] === 'refused')) invalid('Native PR linking needs separate relate-ticket consent and credential access.');
  };
  const read = async (repository: string, pullRequest: string, ticket: string) => {
    if (!pullRequest.startsWith(`${repository}#`)) invalid('The delivery PR must belong to the build repository.');
    const id = numberOf(pullRequest);
    if (!onAzure(repository)) {
      const raw: unknown = JSON.parse(await transport.github(['api', '--method', 'GET', `repos/${repository}/pulls/${id}`]));
      if (!isRecord(raw) || typeof raw.body !== 'string' || !isRecord(raw.base) || !isRecord(raw.base.repo)
        || typeof raw.base.repo.default_branch !== 'string' || raw.base.ref !== raw.base.repo.default_branch) invalid('The closing PR must target the default branch and have a readable body.');
      return { content: raw.body as string, linked: (raw.body as string).split('\n').includes(`Closes ${ticket}`) };
    }
    const { project, flags } = scope(repository);
    const raw: unknown = JSON.parse(await transport.azure(['repos', 'pr', 'show', '--id', id, ...flags]));
    if (!isRecord(raw) || !isRecord(raw.repository) || !isRecord(raw.repository.project)
      || raw.repository.name !== decodePart(repository.split('/')[2]!) || raw.repository.project.name !== project || Number(raw.pullRequestId) !== Number(id)) invalid('The provider returned another delivery PR.');
    const items: unknown = JSON.parse(await transport.azure(['repos', 'pr', 'work-item', 'list', '--id', id, ...flags]));
    if (!Array.isArray(items) || items.some((item) => !isRecord(item) || !/^[1-9]\d*$/.test(String(item.id)))) invalid('The provider returned unreadable PR work-item links.');
    return { content: `Link ${ticket} to ${pullRequest}. Preserve the native PR completion settings.`, linked: items.some((item) => String(item.id) === numberOf(ticket)) };
  };
  const prepare = async (workId: string): Promise<PublicationPlan | null> => {
    const { work, ticket } = target(workId);
    if (!ticket) return null;
    if (!work.pullRequest) invalid('Record the delivery PR with set-pr before preparing its relationship.');
    const config = await settings(work.repository);
    const azure = onAzure(work.repository); checkSettings(config, azure);
    const observed = await read(work.repository, work.pullRequest!, ticket);
    if (!azure && !observed.linked) invalid(`Include Closes ${ticket} in the reviewed PR body before preparing verification.`);
    const previous = records.publications(workId).filter((plan) => !plan.supersededBy).at(-1);
    const ready = records.publicationReadiness(workId);
    const published = records.lastPublished(workId).filter((item) => item.operationKind !== 'textual-relationship').at(-1);
    const attached = records.publicationAttachment(workId);
    const url = published?.url ?? attached?.url ?? (azure
      ? `https://dev.azure.com/${work.repository.split('/')[0]}/${encodeURIComponent(scope(work.repository).project)}/_workitems/edit/${numberOf(ticket)}`
      : `https://github.com/${work.repository}/issues/${numberOf(ticket)}`);
    return records.proposePublication(workId, records.read(workId).revision, {
      sources: ready.sources.map(({ workId, revision }) => ({ workId, revision })), ...(previous ? { replaces: previous.planId } : {}),
      tickets: [{ workId, settingsSnapshot: config.snapshot, destination: { provider: azure ? 'azure' : 'github', repository: work.repository, ticket, url },
        vocabulary: {}, typeResolution: { candidates: [], selected: null }, title: 'Delivery PR', body: observed.content }],
      operations: [{ operationId: `pr:${randomUUID()}`, kind: 'pr-closing-reference', ticketWorkId: workId, pullRequest: work.pullRequest!, content: observed.content, dependsOn: [] }],
    });
  };
  const operation = (plan: PublicationPlan) => {
    if (plan.operations.length !== 1 || plan.operations[0]?.kind !== 'pr-closing-reference' || plan.tickets.length !== 1) invalid('Use the publication engine for this plan.');
    const destination = plan.tickets[0]!.destination;
    if (destination.provider !== (onAzure(destination.repository) ? 'azure' : 'github')) invalid('The delivery provider differs from the repository.');
    return plan.operations[0] as Extract<PublicationPlan['operations'][number], { kind: 'pr-closing-reference' }>;
  };
  const inspect = async (workId: string, planId: string): Promise<PublicationPending> => {
    const plan = records.publication(workId, planId); const op = operation(plan); const ticket = plan.tickets[0]!;
    try {
      const config = await settings(ticket.destination.repository); checkSettings(config, ticket.destination.provider === 'azure');
      if (target(workId).ticket !== ticket.destination.ticket) invalid('The published ticket changed. Prepare and approve a replacement.');
      const observed = await read(ticket.destination.repository, op.pullRequest, ticket.destination.ticket!);
      if (observed.content !== op.content) invalid('The PR body changed. Review its content and approve a replacement.');
      const content: PublicationContent = { tickets: [{ ...ticket, settingsSnapshot: config.snapshot }], operations: plan.operations };
      return records.pendingPublication(workId, planId, content);
    } catch (error) {
      const pending = records.pendingPublication(workId, planId);
      return { ...pending, current: false, next: null, reasons: [...pending.reasons, reason(error)] };
    }
  };
  const execute = async (workId: string, planId: string, identity: string) => {
    const pending = await inspect(workId, planId);
    if (!pending.next) return pending;
    const plan = pending.plan; const op = operation(plan); const ticket = plan.tickets[0]!;
    // Finish awaited provider reads before refreshing settings and claiming the outstanding operation.
    const observed = await read(ticket.destination.repository, op.pullRequest, ticket.destination.ticket!);
    const config = await settings(ticket.destination.repository); checkSettings(config, ticket.destination.provider === 'azure');
    if (config.snapshot !== ticket.settingsSnapshot || target(workId).ticket !== ticket.destination.ticket || observed.content !== op.content) return inspect(workId, planId);
    const claim = records.claimPublication(workId, planId, plan.revision, plan.digest, { tickets: plan.tickets, operations: plan.operations }, identity);
    let outcome: { status: 'successful' | 'failed' | 'uncertain'; evidence: string };
    try {
      if (!observed.linked && ticket.destination.provider === 'azure') {
        try {
          await transport.azure(['repos', 'pr', 'work-item', 'add', '--id', numberOf(op.pullRequest), '--work-items', numberOf(ticket.destination.ticket!), ...scope(ticket.destination.repository).flags]);
        } catch (error) {
          if (/HTTP (?:400|401|403|404|410|412|422)\b|TF401027|permission.*denied/i.test(reason(error))) throw new PublicationRefused(reason(error));
          throw error;
        }
        if (!(await read(ticket.destination.repository, op.pullRequest, ticket.destination.ticket!)).linked) throw new Error('The accepted PR link could not be confirmed. Reconcile before retry.');
      } else if (!observed.linked) throw new PublicationRefused('The approved GitHub closing reference is missing.');
      outcome = { status: 'successful', evidence: 'Provider inspection confirms the approved delivery relationship. Native PR completion settings were preserved.' };
    } catch (error) { outcome = { status: error instanceof PublicationRefused ? 'failed' : 'uncertain', evidence: reason(error) }; }
    records.recordPublicationOutcome(workId, planId, records.publication(workId, planId).revision, op.operationId, claim.claimToken, outcome);
    return inspect(workId, planId);
  };
  const reconcile = async (workId: string, planId: string, identity: string) => {
    const plan = records.publication(workId, planId); const op = operation(plan); const ticket = plan.tickets[0]!;
    if (plan.results[0]?.status === 'uncertain') {
      try {
        const observed = await read(ticket.destination.repository, op.pullRequest, ticket.destination.ticket!);
        const evidence = observed.linked && observed.content === op.content ? 'Provider inspection confirms the exact approved PR relationship.' : 'The approved relationship was not confirmed. Ask the user to resolve the outcome before retrying.';
        records.recordPublicationEvidence(workId, planId, records.publication(workId, planId).revision, op.operationId, evidence);
        if (observed.linked && observed.content === op.content) records.resolvePublicationOutcome(workId, planId, records.publication(workId, planId).revision, op.operationId, identity, { status: 'successful', evidence });
      } catch (error) {
        records.recordPublicationEvidence(workId, planId, records.publication(workId, planId).revision, op.operationId, `Reconciliation could not confirm the PR relationship: ${reason(error)}`);
      }
    }
    return inspect(workId, planId);
  };
  return { body, prepare, inspect, execute, reconcile };
}
