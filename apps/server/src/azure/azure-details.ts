// A work item's description and comments, which the item dialog reads when it opens. The board-wide read in
// azure-items.ts leaves them out and stays on API_VERSION.

import { decodePart, onAzure } from '@lar-factory/shared';
import type { Item, ItemComment, ItemDetails, TextFormat } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';
import { ReadProblem } from '../items/item-source.ts';
import { az, orgFlags, problemOf, type Az, type RawWorkItem } from './azure-items.ts';

/** The first API version that returns a work item's `multilineFieldsFormat`. */
const DETAIL_API_VERSION = '7.2-preview.3';
/** The comments API, which is preview-only. */
const COMMENTS_API_VERSION = '7.1-preview.4';
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

/**
 * Reads one work item's details, or says why it can't: the item's repository is not on Azure DevOps, or the `az` error.
 * The work item is read at DETAIL_API_VERSION and its last COMMENT_LIMIT comments at COMMENTS_API_VERSION, newest first.
 * `run` stands in for az in tests.
 */
export async function readAzureItemDetails(item: Item, run: Az = az): Promise<ItemDetails | Refused> {
  if (!item.repo || !onAzure(item.repo) || item.number === null) return { status: 404, error: 'That item is not an Azure DevOps work item.' };
  const [organization, project] = item.repo.split('/') as [string, string];
  const call = async <T>(resource: string, route: string[], version: string, more: string[] = []): Promise<T> => {
    try {
      return JSON.parse(await run(['devops', 'invoke', '--area', 'wit', '--resource', resource, '--route-parameters', `project=${decodePart(project)}`, ...route,
        ...more, '--api-version', version, ...orgFlags(organization)])) as T;
    } catch (err) { throw problemOf(err); }
  };
  try {
    const [workItem, read] = await Promise.all([
      call<RawWorkItem & { multilineFieldsFormat?: Record<string, string> }>('workitems', [`id=${item.number}`], DETAIL_API_VERSION),
      call<RawComments>('comments', [`workItemId=${item.number}`], COMMENTS_API_VERSION, ['--query-parameters', `$top=${COMMENT_LIMIT}`, 'order=desc']),
    ]);
    const body = typeof workItem.fields['System.Description'] === 'string' ? workItem.fields['System.Description'] : '';
    const text = (name: string) => (typeof workItem.fields[name] === 'string' ? workItem.fields[name] : undefined);
    const olderCursor = read.continuationToken || null;
    const assignee = nameOf(workItem.fields['System.AssignedTo']);
    return {
      body,
      format: formatOf(workItem.multilineFieldsFormat?.['System.Description'], body),
      author: nameOf(workItem.fields['System.CreatedBy']),
      assignees: assignee ? [assignee] : [],
      createdAt: text('System.CreatedDate') ?? null,
      ...text('System.IterationPath') && { iteration: text('System.IterationPath') },
      ...text('System.AreaPath') && { area: text('System.AreaPath') },
      subTickets: [],
      comments: read.comments.filter((c) => !c.isDeleted).map(comment),
      hasOlderComments: olderCursor !== null,
      olderCursor,
    };
  } catch (err) {
    if (err instanceof ReadProblem) return { status: 502, error: `${err.message}${err.fix ? ` Run ${err.fix}.` : ''}` };
    return { status: 502, error: err instanceof Error ? err.message : String(err) };
  }
}
