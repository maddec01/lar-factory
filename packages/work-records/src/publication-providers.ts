// Publication adapters use gh/az's local login. They contain no factory labels or workflow mutations.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePart, isRecord, type PublicationTicket } from '@lar-factory/shared';
import { providerCommand } from '@lar-factory/shared/provider-command';

export interface TicketReceipt { ticket: string; url: string }
export interface InspectedTicket extends TicketReceipt { title: string; body: string; type: string | null; labels: string[] }
type Relationship = 'child' | 'blocked-by';
/** Transport errors are uncertain unless the provider explicitly rejects the write before applying it. */
export class PublicationRefused extends Error {}
export interface PublicationProvider {
  capability(ticket: PublicationTicket, related: PublicationTicket, relationship: Relationship): Promise<{ available: true } | { available: false; reason: string }>;
  create(ticket: PublicationTicket): Promise<TicketReceipt>;
  relate(ticket: PublicationTicket, target: TicketReceipt, related: PublicationTicket, other: TicketReceipt, relationship: Relationship): Promise<void>;
  comment(ticket: PublicationTicket, target: TicketReceipt, content: string): Promise<string>;
  search(ticket: PublicationTicket, claimedAt: string): Promise<TicketReceipt[]>;
  inspect(ticket: PublicationTicket, target: TicketReceipt): Promise<InspectedTicket>;
  findComments(ticket: PublicationTicket, target: TicketReceipt): Promise<{ commentId: string; content: string }[]>;
  hasRelationship(ticket: PublicationTicket, target: TicketReceipt, related: PublicationTicket, other: TicketReceipt, relationship: Relationship): Promise<boolean>;
}
export interface PublicationTransport {
  github(args: string[], input?: string): Promise<string>;
  azure(args: string[]): Promise<string>;
}
const numberOf = (target: TicketReceipt) => {
  const number = /#([1-9]\d*)$/.exec(target.ticket)?.[1];
  if (!number) throw new Error('The provider ticket has no numeric ID.');
  return Number(number);
};
const labelsOf = (ticket: PublicationTicket) => [...new Set(Object.values(ticket.vocabulary).flatMap((v) => v.labels))];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const object = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) throw new Error('The provider returned an unreadable object.');
  return raw;
};
const text = (raw: unknown): string => { if (typeof raw !== 'string') throw new Error('The provider returned unreadable text.'); return raw; };
const idOf = (raw: unknown): number => { if (!Number.isSafeInteger(raw) || Number(raw) < 1) throw new Error('The provider returned no positive ID.'); return Number(raw); };
const list = (raw: unknown): unknown[] => { if (!Array.isArray(raw)) throw new Error('The provider returned an unreadable list.'); return raw; };
function pages(raw: unknown): unknown[] { return list(raw).flatMap((page) => Array.isArray(page) ? page : [page]); }
async function withFile<T>(value: unknown, use: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'publication-'));
  try { const file = join(dir, 'body.json'); await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return await use(file); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

/** Azure creation/reads/comments use invoke. Only revision-guarded work-item PATCH uses az rest (ADR 0029).
 * No transport retries. GitHub reads paginate; Azure recovery reads by a bounded WIQL result then batch-inspects. */
export function publicationProvider(transport: PublicationTransport = {
  github: (args, input) => providerCommand('gh', args, input), azure: (args) => providerCommand('az', args),
}): PublicationProvider {
  const github = async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    try { return JSON.parse(await transport.github(['api', '--method', method, path, ...(body === undefined ? [] : ['--input', '-'])], body === undefined ? undefined : JSON.stringify(body))); }
    catch (error) {
      // A timeout, 5xx, 429, duplicate conflict or unreadable response may have applied a write.
      if (method !== 'GET' && /HTTP (?:400|401|403|404|410|422)\b/.test(message(error))) throw new PublicationRefused(message(error));
      throw error;
    }
  };
  const githubList = async (path: string) => pages(JSON.parse(await transport.github(['api', '--method', 'GET', path, '--paginate', '--slurp'])));
  const scope = (ticket: PublicationTicket) => {
    const [organization, project] = ticket.destination.repository.split('/');
    return { organization: organization!, project: decodePart(project!), flags: ['--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'] };
  };
  const invoke = async (ticket: PublicationTicket, resource: string, route: string[] = [], body?: unknown, version = '7.1', more: string[] = []) => {
    const { project, flags } = scope(ticket);
    try {
      const run = (file?: string) => transport.azure(['devops', 'invoke', '--area', 'wit', '--resource', resource, '--route-parameters', `project=${project}`, ...route,
        '--http-method', body === undefined ? 'GET' : 'POST', ...(file ? ['--in-file', file] : []), ...more, '--api-version', version, ...flags]);
      return JSON.parse(body === undefined ? await run() : await withFile(body, run)) as unknown;
    } catch (error) {
      if (body !== undefined && /TF237111|HTTP (?:400|401|403|404|410|422)\b|permissions? to save work items/i.test(message(error))) throw new PublicationRefused(message(error));
      throw error;
    }
  };
  const azureRaw = async (ticket: PublicationTicket, target: TicketReceipt) => {
    const raw = object(await invoke(ticket, 'workitemsbatch', [], { ids: [numberOf(target)], $expand: 'Relations', errorPolicy: 'Fail' }, '7.2-preview'));
    const item = list(raw.value)[0]; if (!item) throw new Error('The provider did not return the work item.'); return object(item);
  };
  const azureReceipt = (ticket: PublicationTicket, raw: Record<string, unknown>): TicketReceipt => {
    const id = idOf(raw.id); const { organization, project } = scope(ticket);
    return { ticket: `${ticket.destination.repository}#${id}`, url: `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_workitems/edit/${id}` };
  };
  const githubReceipt = (ticket: PublicationTicket, raw: Record<string, unknown>): TicketReceipt => {
    const id = idOf(raw.number); const url = text(raw.html_url);
    if (url !== `https://github.com/${ticket.destination.repository}/issues/${id}`) throw new Error('The provider returned a ticket outside the approved destination.');
    return { ticket: `${ticket.destination.repository}#${id}`, url };
  };
  const apiUrl = (ticket: PublicationTicket, target: TicketReceipt) => {
    const { organization, project } = scope(ticket);
    return `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workItems/${numberOf(target)}`;
  };
  const azureRelation = (relationship: Relationship) => relationship === 'child' ? 'System.LinkTypes.Hierarchy-Reverse' : 'System.LinkTypes.Dependency-Reverse';
  const relationshipPath = (ticket: PublicationTicket, target: TicketReceipt, related: PublicationTicket, other: TicketReceipt, relationship: Relationship) =>
    relationship === 'child' ? `repos/${related.destination.repository}/issues/${numberOf(other)}/sub_issues` : `repos/${ticket.destination.repository}/issues/${numberOf(target)}/dependencies/blocked_by`;
  return {
    capability: async (ticket, related, relationship) => {
      if (ticket.destination.provider !== related.destination.provider) return { available: false, reason: 'The providers cannot create a native relationship between these tickets.' };
      if (ticket.destination.provider === 'github') return { available: true };
      if (scope(ticket).organization !== scope(related).organization) return { available: false, reason: 'The Azure organizations differ.' };
      const raw = object(await invoke(ticket, 'workitemrelationtypes'));
      const name = azureRelation(relationship);
      const supported = list(raw.value).some((r) => object(r).referenceName === name && object(object(r).attributes).enabled === true);
      return supported ? { available: true } : { available: false, reason: `Azure does not offer ${name}.` };
    },
    create: async (ticket) => {
      if (ticket.destination.provider === 'github') {
        const raw = object(await github(`repos/${ticket.destination.repository}/issues`, 'POST', { title: ticket.title, body: ticket.body,
          labels: labelsOf(ticket), ...(ticket.typeResolution.selected === null ? {} : { type: ticket.typeResolution.selected }) }));
        return githubReceipt(ticket, raw);
      }
      const type = ticket.typeResolution.selected;
      if (!type) throw new PublicationRefused('Azure requires an explicitly mapped work item type.');
      const labels = labelsOf(ticket);
      if (labels.some((label) => label.includes(';'))) throw new PublicationRefused('Azure tags cannot contain a semicolon.');
      const patch = [{ op: 'add', path: '/fields/System.Title', value: ticket.title }, { op: 'add', path: '/fields/System.Description', value: ticket.body },
        { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
        ...(labels.length ? [{ op: 'add', path: '/fields/System.Tags', value: labels.join('; ') }] : [])];
      const raw = object(await invoke(ticket, 'workitems', [`type=${type}`], patch, '7.2-preview', ['--media-type', 'application/json-patch+json']));
      return azureReceipt(ticket, raw);
    },
    relate: async (ticket, target, related, other, relationship) => {
      if (ticket.destination.provider === 'github') {
        const linkedTicket = relationship === 'child' ? ticket : related;
        const linkedReceipt = relationship === 'child' ? target : other;
        const linked = object(await github(`repos/${linkedTicket.destination.repository}/issues/${numberOf(linkedReceipt)}`));
        await github(relationshipPath(ticket, target, related, other, relationship), 'POST', { [relationship === 'child' ? 'sub_issue_id' : 'issue_id']: idOf(linked.id) });
        return;
      }
      const raw = await azureRaw(ticket, target);
      const { organization, project } = scope(ticket);
      const patch = [{ op: 'test', path: '/rev', value: idOf(raw.rev) }, { op: 'add', path: '/relations/-', value: { rel: azureRelation(relationship), url: apiUrl(related, other) } }];
      try {
        await withFile(patch, (file) => transport.azure(['rest', '--method', 'patch', '--resource', '499b84ac-1321-427f-aa17-267ca6975798',
          '--url', `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_apis/wit/workitems/${numberOf(target)}?api-version=7.1`,
          '--headers', 'Content-Type=application/json-patch+json', '--body', `@${file}`, '--output', 'json']));
      } catch (error) {
        if (/TF26071|TF237111|\b(?:400|401|403|404|412|422)\b/.test(message(error))) throw new PublicationRefused(message(error));
        throw error;
      }
    },
    comment: async (ticket, target, content) => {
      const raw = object(ticket.destination.provider === 'github'
        ? await github(`repos/${ticket.destination.repository}/issues/${numberOf(target)}/comments`, 'POST', { body: content })
        : await invoke(ticket, 'comments', [`workItemId=${numberOf(target)}`], { text: content }, '7.1-preview', ['--query-parameters', 'format=markdown']));
      return String(idOf(raw.id));
    },
    search: async (ticket, claimedAt) => {
      if (ticket.destination.provider === 'github') {
        // Search without an identity marker. Include closed issues and every page; inspect full payloads separately.
        const raw = await githubList(`repos/${ticket.destination.repository}/issues?state=all&sort=created&direction=desc&since=${encodeURIComponent(claimedAt)}&per_page=100`);
        return raw.filter((r) => object(r).pull_request === undefined && object(r).title === ticket.title).map((r) => githubReceipt(ticket, object(r)));
      }
      const { project } = scope(ticket);
      const escape = (value: string) => value.replaceAll("'", "''");
      const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escape(project)}' AND [System.Title] = '${escape(ticket.title)}' AND [System.CreatedDate] >= '${escape(claimedAt)}' ORDER BY [System.CreatedDate] DESC`;
      const raw = object(await invoke(ticket, 'wiql', [], { query }));
      return list(raw.workItems).map((item) => azureReceipt(ticket, object(item)));
    },
    inspect: async (ticket, target) => {
      if (ticket.destination.provider === 'github') {
        const raw = object(await github(`repos/${ticket.destination.repository}/issues/${numberOf(target)}`));
        return { ...githubReceipt(ticket, raw), title: text(raw.title), body: text(raw.body), type: raw.type === null || raw.type === undefined ? null : text(object(raw.type).name), labels: list(raw.labels).map((l) => text(object(l).name)) };
      }
      const raw = await azureRaw(ticket, target); const fields = object(raw.fields);
      if (object(raw.multilineFieldsFormat)['System.Description'] !== 'Markdown') throw new Error('Azure did not preserve the approved Markdown format.');
      return { ...azureReceipt(ticket, raw), title: text(fields['System.Title']), body: text(fields['System.Description']), type: text(fields['System.WorkItemType']),
        labels: typeof fields['System.Tags'] === 'string' ? fields['System.Tags'].split(';').map((s) => s.trim()).filter(Boolean) : [] };
    },
    findComments: async (ticket, target) => {
      if (ticket.destination.provider === 'github') {
        return (await githubList(`repos/${ticket.destination.repository}/issues/${numberOf(target)}/comments?per_page=100`))
          .map((raw) => ({ commentId: String(idOf(object(raw).id)), content: text(object(raw).body) }));
      }
      const comments: { commentId: string; content: string }[] = [];
      let continuation: string | undefined;
      const seen = new Set<string>();
      do {
        const raw = object(await invoke(ticket, 'comments', [`workItemId=${numberOf(target)}`], undefined, '7.1-preview',
          ['--query-parameters', '$top=200', 'order=desc', ...(continuation ? [`continuationToken=${continuation}`] : [])]));
        comments.push(...list(raw.comments).map((c) => ({ commentId: String(idOf(object(c).id)), content: text(object(c).text) })));
        continuation = raw.continuationToken === undefined || raw.continuationToken === null ? undefined : String(raw.continuationToken);
        if (continuation && seen.has(continuation)) throw new Error('Azure repeated a comment continuation token; inspection is incomplete.');
        if (continuation) seen.add(continuation);
      } while (continuation);
      return comments;
    },
    hasRelationship: async (ticket, target, related, other, relationship) => {
      if (ticket.destination.provider === 'github') {
        const expected = relationship === 'child' ? target : other;
        const expectedRepo = relationship === 'child' ? ticket : related;
        const raw = await githubList(`${relationshipPath(ticket, target, related, other, relationship)}?per_page=100`);
        return raw.some((r) => object(r).html_url === `https://github.com/${expectedRepo.destination.repository}/issues/${numberOf(expected)}`);
      }
      const raw = await azureRaw(ticket, target);
      return (raw.relations === undefined ? [] : list(raw.relations)).some((r) => object(r).rel === azureRelation(relationship)
        && String(object(r).url).toLowerCase() === apiUrl(related, other).toLowerCase());
    },
  };
}
