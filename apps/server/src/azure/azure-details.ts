// A work item's description and comments, which the item dialog reads when it opens. The board-wide read in
// azure-items.ts leaves them out and stays on API_VERSION. az devops invoke can't pass a preview's resource version,
// as in 7.1-preview.4: it reads the version as a number. Given 7.1-preview, az adds the server's latest one.

import { decodePart, onAzure } from '@lar-factory/shared';
import type { AzureBodyField, IssueRef, Item, ItemComment, ItemCommentsPage, ItemDetails, TextFormat } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';
import { ReadProblem } from '../items/item-source.ts';
import { API_VERSION, az, azureWorkItem, field, linked, orgFlags, problemOf, withFile, workItemUrl, type Az, type RawWorkItem } from './azure-items.ts';

/** The work items batch read that returns a work item's `multilineFieldsFormat`, which az sends as 7.2-preview.1. */
const DETAIL_API_VERSION = '7.2-preview';
/** The comments API, which is preview-only; az sends it as 7.1-preview.4, the first whose comments say their format. */
const COMMENTS_API_VERSION = '7.1-preview';
/** Comments read per open; older ones are paged by their continuation token. */
const COMMENT_LIMIT = 10;

/** An identity field: an object with a display name, or, from older API versions, the display name itself. */
type RawIdentity = { displayName?: string } | string | undefined;

interface RawComment {
  id: number;
  text?: string;
  createdDate: string;
  createdBy?: RawIdentity;
  format?: string;
  isDeleted?: boolean;
}

interface RawComments {
  comments: RawComment[];
  continuationToken?: string | null;
}

const nameOf = (identity: unknown): string | null => {
  const raw = identity as RawIdentity;
  const name = typeof raw === 'string' ? raw : raw?.displayName;
  return name || null;
};

/** The format a field says it has, else HTML when the text opens with a tag, else markdown. */
function formatOf(said: string | undefined, text: string): TextFormat {
  if (said?.toLowerCase() === 'html') return 'html';
  if (said?.toLowerCase() === 'markdown') return 'markdown';
  return /^\s*<[a-z!/]/i.test(text) ? 'html' : 'markdown';
}

const comment = (raw: RawComment): ItemComment => {
  const body = raw.text ?? '';
  return { id: String(raw.id), author: nameOf(raw.createdBy) ?? 'unknown', createdAt: raw.createdDate, body, format: formatOf(raw.format, body) };
};

/** One `az devops invoke` of the work item tracking area, its answer parsed. */
type Call = <R>(resource: string, route: string[], version: string, more?: string[]) => Promise<R>;

/** Runs `use` with a call for an Azure DevOps item, and its repository, or says why it can't: the item is not a work item, or the `az` error. */
async function inArea<T>(item: Item, run: Az, use: (call: Call, repo: string) => Promise<T>): Promise<T | Refused> {
  if (!item.repo || !onAzure(item.repo) || item.number === null) return { status: 404, error: 'That item is not an Azure DevOps work item.' };
  const [organization, project] = item.repo.split('/') as [string, string];
  const call = async <R>(resource: string, route: string[], version: string, more: string[] = []): Promise<R> => {
    try {
      return JSON.parse(await run(['devops', 'invoke', '--area', 'wit', '--resource', resource, '--route-parameters', `project=${decodePart(project)}`, ...route,
        ...more, '--api-version', version, ...orgFlags(organization)])) as R;
    } catch (err) { throw problemOf(err); }
  };
  try {
    return await use(call, item.repo);
  } catch (err) {
    if (err instanceof ReadProblem) return { status: 502, error: `${err.message}${err.fix ? ` Run ${err.fix}.` : ''}` };
    return { status: 502, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The comments call for a work item: COMMENT_LIMIT newest first from `token`, or from the newest when none. */
const readComments = (call: Call, item: Item, token?: string) =>
  call<RawComments>('comments', [`workItemId=${item.number}`], COMMENTS_API_VERSION, ['--query-parameters', `$top=${COMMENT_LIMIT}`, 'order=desc', ...token ? [`continuationToken=${token}`] : []]);

/** Named children, Related work and predecessors in shared batches of at most 200. Removed children stay hidden. */
async function relationsOf(call: Call, repo: string, workItem: RawWorkItem): Promise<Pick<ItemDetails, 'subTickets' | 'related' | 'blockers'>> {
  const childIds = linked(workItem, 'System.LinkTypes.Hierarchy-Forward');
  const relatedIds = linked(workItem, 'System.LinkTypes.Related');
  const blockerIds = linked(workItem, 'System.LinkTypes.Dependency-Reverse');
  const ids = [...new Set([...childIds, ...relatedIds, ...blockerIds])];
  if (!ids.length) return { subTickets: [] };
  const [organization, project] = repo.split('/') as [string, string];
  const batches = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, (i + 1) * 200));
  const reads = await Promise.all(batches.map((batch) => withFile({ ids: batch, fields: ['System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo'], errorPolicy: 'Omit' }, (file) =>
    call<{ value: (RawWorkItem | null)[] }>('workitemsbatch', [], API_VERSION, ['--http-method', 'POST', '--in-file', file]))));
  const children = reads.flatMap(({ value }) => value.filter((raw): raw is RawWorkItem => raw !== null));
  const types = [...new Set(children.map((raw) => field(raw, 'System.WorkItemType')))];
  const states = await Promise.all(types.map((type) => call<{ value: { name: string; category: string }[] }>('workitemtypestates', [`type=${type}`], API_VERSION)));
  const category = new Map(types.map((type, i) => [type, new Map(states[i]!.value.map((s) => [s.name, s.category]))]));
  const refs = new Map(children.map((raw): [number, IssueRef] => {
    const kind = category.get(field(raw, 'System.WorkItemType'))?.get(field(raw, 'System.State'));
    return [raw.id, { number: raw.id, title: field(raw, 'System.Title'), url: workItemUrl(organization, project, raw.id), repo, state: kind === 'Completed' || kind === 'Removed' ? 'closed' : 'open', azure: azureWorkItem(raw) }];
  }));
  const references = (ids: number[]) => [...new Set(ids)].flatMap((id) => refs.get(id) ?? []);
  const removed = new Set(children.filter((raw) => category.get(field(raw, 'System.WorkItemType'))?.get(field(raw, 'System.State')) === 'Removed').map((raw) => raw.id));
  return { subTickets: references(childIds.filter((id) => !removed.has(id))),
    ...relatedIds.length > 0 && { related: references(relatedIds) },
    ...blockerIds.length > 0 && { blockers: references(blockerIds) } };
}

/**
 * Reads one work item's details, or says why it can't: the item's repository is not on Azure DevOps, or the `az` error.
 * The work item is a batch read at DETAIL_API_VERSION with its links, as az devops invoke can't reach wit/workitems' {id}
 * route, and its last COMMENT_LIMIT comments are read at COMMENTS_API_VERSION, newest first.
 * Its child work items are batched by 200, with a states read per child type.
 * `run` stands in for az in tests.
 */
export const readAzureItemDetails = (item: Item, run: Az = az): Promise<ItemDetails | Refused> => inArea(item, run, async (call, repo) => {
  // Both read at once, but a work item the batch leaves out answers 404 before the comments read fails for it.
  const comments = readComments(call, item);
  comments.catch(() => {});
  const { value: [workItem] } = await withFile({ ids: [item.number], $expand: 'Relations', errorPolicy: 'Omit' }, (file) =>
    call<{ value: ((RawWorkItem & { multilineFieldsFormat?: Record<string, string> }) | null)[] }>('workitemsbatch', [], DETAIL_API_VERSION, ['--http-method', 'POST', '--in-file', file]));
  if (!workItem) return { status: 404, error: `Work item ${item.number} does not exist, or you have no right to read it.` };
  const read = await comments;
  const text = (name: string) => (typeof workItem.fields[name] === 'string' ? workItem.fields[name] : undefined);
  const hasContent = (value: string) => Boolean(value.replace(/<[^>]*>|&nbsp;|&#160;/g, '').trim()) || /<(?:img|video|iframe)\b/i.test(value);
  const description = text('System.Description') ?? '';
  // A Bug's form shows Repro Steps as its description, so a Bug with no System.Description saves there too.
  const bodyField: AzureBodyField = hasContent(description) || (!hasContent(text('Microsoft.VSTS.TCM.ReproSteps') ?? '') && field(workItem, 'System.WorkItemType') !== 'Bug')
    ? 'System.Description' : 'Microsoft.VSTS.TCM.ReproSteps';
  const body = text(bodyField) ?? '';
  const descriptionFields = [
    ['Microsoft.VSTS.TCM.ReproSteps', 'Repro Steps'],
    ['Microsoft.VSTS.Common.AcceptanceCriteria', 'Acceptance Criteria'],
    ['Microsoft.VSTS.TCM.SystemInfo', 'System Info'],
  ] as const;
  const sections = descriptionFields.flatMap(([name, title]) => {
    const body = text(name) ?? '';
    return name !== bodyField && hasContent(body) ? [{ title, body, format: formatOf(workItem.multilineFieldsFormat?.[name], body) }] : [];
  });
  const olderCursor = read.continuationToken || null;
  let relationsError: string | undefined;
  const relations = await relationsOf(call, repo, workItem).catch((err: unknown) => {
    relationsError = err instanceof Error ? err.message : String(err);
    return { subTickets: [] };
  });
  const attachments = (workItem.relations ?? []).flatMap((r) => {
    if (r.rel !== 'AttachedFile' || !URL.canParse(r.url)) return [];
    const url = new URL(r.url);
    if (url.protocol !== 'https:' || !(url.hostname === 'dev.azure.com' || url.hostname.endsWith('.visualstudio.com'))) return [];
    return [{ name: r.attributes?.name || 'Attachment', url: r.url }];
  });
  const assignee = nameOf(workItem.fields['System.AssignedTo']);
  return {
    body,
    format: formatOf(workItem.multilineFieldsFormat?.[bodyField], body),
    bodyField,
    ...workItem.rev !== undefined && { revision: workItem.rev },
    ...sections.length > 0 && { sections },
    author: nameOf(workItem.fields['System.CreatedBy']),
    assignees: assignee ? [assignee] : [],
    createdAt: text('System.CreatedDate') ?? null,
    ...text('System.IterationPath') && { iteration: text('System.IterationPath') },
    ...text('System.AreaPath') && { area: text('System.AreaPath') },
    ...relations,
    ...attachments.length > 0 && { attachments },
    ...relationsError !== undefined && { relationsError },
    comments: read.comments.filter((c) => !c.isDeleted).map(comment),
    hasOlderComments: olderCursor !== null,
    olderCursor,
  };
});

/** Reads the COMMENT_LIMIT comments after the continuation token `before`, newest first, or says why it can't. */
export const readAzureOlderComments = (item: Item, before: string, run: Az = az): Promise<ItemCommentsPage | Refused> => inArea(item, run, async (call) => {
  const read = await readComments(call, item, before);
  return { comments: read.comments.filter((c) => !c.isDeleted).map(comment), olderCursor: read.continuationToken || null };
});
