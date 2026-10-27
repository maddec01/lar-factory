// An issue's, pull request's or draft's description and comments, which the item dialog reads when it opens.
// The board-wide read in github.ts leaves them out.

import type { IssueRef, Item, ItemComment, ItemDetails } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';
import { graphql, message } from './github.ts';

/** Comments read per open; older ones are paged by their cursor. */
const COMMENT_LIMIT = 10;
/** Sub-issues read per item. */
const SUB_TICKET_LIMIT = 50;

const PEOPLE = 'createdAt assignees(first: 20) { nodes { login } }';
const TEXT = `body ${PEOPLE}
  comments(last: ${COMMENT_LIMIT}) { pageInfo { hasPreviousPage startCursor } nodes { id author { login } createdAt body } }`;

/**
 * One item's details by node id, in one call: an issue and a pull request share their fields, an issue
 * adds its sub-issues, and a draft has a body and creator but no comments.
 */
export const ITEM_DETAILS_QUERY = `query($id: ID!) {
  node(id: $id) {
    __typename
    ... on DraftIssue { body creator { login } ${PEOPLE} }
    ... on Issue {
      ${TEXT}
      author { login }
      milestone { title }
      subIssues(first: ${SUB_TICKET_LIMIT}) { nodes { number title url state repository { nameWithOwner } } }
    }
    ... on PullRequest {
      ${TEXT}
      author { login }
      milestone { title }
    }
  }
}`;

interface RawLogin {
  login: string;
}

interface RawComment {
  id: string;
  author: RawLogin | null;
  createdAt: string;
  body: string;
}

interface RawDetails {
  body?: string;
  author?: RawLogin | null;
  creator?: RawLogin | null;
  createdAt?: string;
  assignees?: { nodes: RawLogin[] };
  milestone?: { title: string } | null;
  subIssues?: { nodes: { number: number; title: string; url: string; state: 'OPEN' | 'CLOSED'; repository: { nameWithOwner: string } }[] };
  comments?: { pageInfo: { hasPreviousPage: boolean; startCursor: string | null }; nodes: RawComment[] };
}

/** A comment whose author's account is gone, which GitHub shows as `ghost`. */
const GHOST = 'ghost';

const comment = (raw: RawComment): ItemComment => ({ id: raw.id, author: raw.author?.login ?? GHOST, createdAt: raw.createdAt, body: raw.body, format: 'markdown' });

const subTicket = (raw: NonNullable<RawDetails['subIssues']>['nodes'][number]): IssueRef =>
  ({ number: raw.number, title: raw.title, url: raw.url, repo: raw.repository.nameWithOwner, state: raw.state === 'OPEN' ? 'open' : 'closed' });

/** Reads one GitHub item's details, or says why it can't: no such item, or the `gh` error. */
export async function readGithubItemDetails(item: Item, run?: (args: string[]) => Promise<string>): Promise<ItemDetails | Refused> {
  let node: RawDetails | null;
  try { node = (await graphql<{ data: { node: RawDetails | null } }>(ITEM_DETAILS_QUERY, { id: item.id }, run)).data.node; }
  catch (err) { return { status: 502, error: message(err) }; }
  if (!node) return { status: 404, error: 'GitHub has no such item.' };
  const { comments } = node;
  const hasOlderComments = comments?.pageInfo.hasPreviousPage ?? false;
  return {
    body: node.body ?? '',
    format: 'markdown',
    author: (node.author ?? node.creator)?.login ?? null,
    assignees: node.assignees?.nodes.map((a) => a.login) ?? [],
    createdAt: node.createdAt ?? null,
    ...(node.milestone ? { milestone: node.milestone.title } : {}),
    subTickets: node.subIssues?.nodes.map(subTicket) ?? [],
    // GitHub lists the last 10 oldest first; the dialog reads newest first.
    comments: (comments?.nodes ?? []).map(comment).reverse(),
    hasOlderComments,
    olderCursor: hasOlderComments ? comments?.pageInfo.startCursor ?? null : null,
  };
}
