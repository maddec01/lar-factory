import { isStructureComment, stripTrackerStructure, writeTrackerStructure } from '@lar-factory/shared';
// An issue's description and comments, which the item dialog reads when it opens.
// The board-wide read in github.ts leaves them out.

import type { IssueRef, Item, ItemComment, ItemCommentsPage, ItemDetails } from '@lar-factory/shared';
import type { Refused } from '../config/editable-repository.ts';
import { skipEmptyCommentPages } from '../item-details/comment-pages.ts';
import { editIssueBody, readIssue, graphql, message } from './github.ts';

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

/** Larger reads cross factory comment batches without one CLI call per ten transport comments. */
const COMMENT_LOOKAHEAD_QUERY = OLDER_COMMENTS_QUERY.replace('last: 10,', 'last: 100,');

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
  const discussion = await skipEmptyCommentPages(commentPage(node.comments), (before) => readGithubCommentPage(item, before, COMMENT_LOOKAHEAD_QUERY, run));
  if ('error' in discussion) return discussion;
  return {
    body: stripTrackerStructure(node.body ?? ''),
    format: 'markdown',
    author: node.author?.login ?? null,
    assignees: node.assignees?.nodes.map((a) => a.login) ?? [],
    createdAt: node.createdAt ?? null,
    ...(node.milestone ? { milestone: node.milestone.title } : {}),
    subTickets: node.subIssues?.nodes.map(subTicket) ?? [],
    ...discussion,
    hasOlderComments: discussion.olderCursor !== null,
  };
}

/** Where the next older page starts; null when GitHub has none before this one. */
const olderCursor = (comments: RawComments | undefined): string | null => (comments?.pageInfo.hasPreviousPage ? comments.pageInfo.startCursor : null);

/** GitHub lists each page oldest first; the dialog reads newest first. */
const commentPage = (comments: RawComments | undefined): ItemCommentsPage => ({
  comments: (comments?.nodes ?? []).filter((comment) => !isStructureComment(comment.body)).map(toComment).reverse(),
  olderCursor: olderCursor(comments),
});

/** Reads the 10 comments before `before` on one item, newest first, or says why it can't. */
export async function readGithubOlderComments(item: Item, before: string, run?: (args: string[]) => Promise<string>): Promise<ItemCommentsPage | Refused> {
  const first = await readGithubCommentPage(item, before, OLDER_COMMENTS_QUERY, run);
  if ('error' in first) return first;
  return skipEmptyCommentPages(first, (cursor) => readGithubCommentPage(item, cursor, COMMENT_LOOKAHEAD_QUERY, run));
}

async function readGithubCommentPage(item: Item, before: string, query: string, run?: (args: string[]) => Promise<string>): Promise<ItemCommentsPage | Refused> {
  let node: RawDetails | null;
  try { node = (await graphql<{ data: { node: RawDetails | null } }>(query, { id: item.id, before }, run)).data.node; }
  catch (err) { return { status: 502, error: message(err) }; }
  if (!node?.comments) return { status: 404, error: 'GitHub has no such item.' };
  return commentPage(node.comments);
}

/** Saves `body` as the issue's markdown body. Returns null, or the refusal: 403 when GitHub refuses the edit, else 502 with gh's message. */
export async function saveGithubDescription(item: Item, body: string, run?: (args: string[]) => Promise<string>): Promise<Refused | null> {
  if (!item.repo || item.number === null) return { status: 404, error: 'That item is not a GitHub issue.' };
  try {
    if (item.tracker) {
      const current = await readIssue(item.repo,item.number,run);
      if (!current?.tracker) return {status:409,error:'The saved issue structure changed. Open the latest description before editing.'};
      body = writeTrackerStructure(body,current.tracker);
    }
    await editIssueBody(item.repo, item.number, body, run);
    return null;
  } catch (err) {
    const text = message(err);
    return { status: /HTTP 403|not accessible|permission/i.test(text) ? 403 : 502, error: `Could not save the description. ${text}` };
  }
}
