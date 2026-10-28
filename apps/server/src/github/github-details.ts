// An issue's description and comments, which the item dialog reads when it opens.
// The board-wide read in github.ts leaves them out.

import type { IssueRef, Item, ItemComment, ItemCommentsPage, ItemDetails } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';
import { graphql, message } from './github.ts';

/** Comments read per open; older ones are paged by their cursor. */
const COMMENT_LIMIT = 10;
/** Sub-issues read per item. */
const SUB_TICKET_LIMIT = 50;

const PEOPLE = 'createdAt assignees(first: 20) { nodes { login } }';
const comments = (args: string) => `comments(${args}) { pageInfo { hasPreviousPage startCursor } nodes { id author { login } createdAt body } }`;
const TEXT = `body ${PEOPLE}
  ${comments(`last: ${COMMENT_LIMIT}`)}`;

/**
 * One issue's details and sub-issues by node id, in one call.
 */
export const ITEM_DETAILS_QUERY = `query($id: ID!) {
  node(id: $id) {
    __typename
    ... on Issue {
      ${TEXT}
      author { login }
      milestone { title }
      subIssues(first: ${SUB_TICKET_LIMIT}) { nodes { number title url state repository { nameWithOwner } } }
    }
  }
}`;

/** The 10 comments before a cursor, on an issue. */
export const OLDER_COMMENTS_QUERY = `query($id: ID!, $before: String!) {
  node(id: $id) {
    __typename
    ... on Issue { ${comments(`last: ${COMMENT_LIMIT}, before: $before`)} }
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

interface RawComments {
  pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
  nodes: RawComment[];
}

interface RawDetails {
  body?: string;
  author?: RawLogin | null;
  createdAt?: string;
  assignees?: { nodes: RawLogin[] };
  milestone?: { title: string } | null;
  subIssues?: { nodes: { number: number; title: string; url: string; state: 'OPEN' | 'CLOSED'; repository: { nameWithOwner: string } }[] };
  comments?: RawComments;
}

/** A comment whose author's account is gone, which GitHub shows as `ghost`. */
const GHOST = 'ghost';

const toComment = (raw: RawComment): ItemComment => ({ id: raw.id, author: raw.author?.login ?? GHOST, createdAt: raw.createdAt, body: raw.body, format: 'markdown' });

const subTicket = (raw: NonNullable<RawDetails['subIssues']>['nodes'][number]): IssueRef =>
  ({ number: raw.number, title: raw.title, url: raw.url, repo: raw.repository.nameWithOwner, state: raw.state === 'OPEN' ? 'open' : 'closed' });

/** Reads one GitHub item's details, or says why it can't: no such item, or the `gh` error. */
export async function readGithubItemDetails(item: Item, run?: (args: string[]) => Promise<string>): Promise<ItemDetails | Refused> {
  let node: RawDetails | null;
  try { node = (await graphql<{ data: { node: RawDetails | null } }>(ITEM_DETAILS_QUERY, { id: item.id }, run)).data.node; }
  catch (err) { return { status: 502, error: message(err) }; }
  if (!node) return { status: 404, error: 'GitHub has no such item.' };
  const { comments } = node;
  const older = olderCursor(comments);
  return {
    body: node.body ?? '',
    format: 'markdown',
    author: node.author?.login ?? null,
    assignees: node.assignees?.nodes.map((a) => a.login) ?? [],
    createdAt: node.createdAt ?? null,
    ...(node.milestone ? { milestone: node.milestone.title } : {}),
    subTickets: node.subIssues?.nodes.map(subTicket) ?? [],
    // GitHub lists the last 10 oldest first; the dialog reads newest first.
    comments: (comments?.nodes ?? []).map(toComment).reverse(),
    hasOlderComments: older !== null,
    olderCursor: older,
  };
}

/** Where the next older page starts; null when GitHub has none before this one. */
const olderCursor = (comments: RawComments | undefined): string | null => (comments?.pageInfo.hasPreviousPage ? comments.pageInfo.startCursor : null);

/** Reads the 10 comments before `before` on one item, newest first, or says why it can't. */
export async function readGithubOlderComments(item: Item, before: string, run?: (args: string[]) => Promise<string>): Promise<ItemCommentsPage | Refused> {
  let node: RawDetails | null;
  try { node = (await graphql<{ data: { node: RawDetails | null } }>(OLDER_COMMENTS_QUERY, { id: item.id, before }, run)).data.node; }
  catch (err) { return { status: 502, error: message(err) }; }
  if (!node?.comments) return { status: 404, error: 'GitHub has no such item.' };
  return { comments: node.comments.nodes.map(toComment).reverse(), olderCursor: olderCursor(node.comments) };
}
