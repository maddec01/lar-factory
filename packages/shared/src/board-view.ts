// What the board page shows, as data and plain text: its sections, each status's hint, a PR's link text, and what
// Abandon asks.

import { STATUSES, inRepo, isRecentlyDone, onAzure, itemName, repoKey, repoName, sameRepo } from './model.ts';
import type { BoardData, Item, LinkedPr, Status } from './model.ts';
import { slug } from './format.ts';

export function byFlowOrder(a: Item, b: Item): number {
  return (
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    (a.repo ?? '').localeCompare(b.repo ?? '') ||
    (a.number ?? 0) - (b.number ?? 0)
  );
}

export function listGroupId(repo: string): string {
  return `list-${slug(repo)}`;
}

export interface ListGroup {
  /** The repository's repository key. */
  repo: string;
  name: string;
  id: string;
  items: Item[];
}

export interface BoardSections {
  /** The desk: Ready, Needs you, Verify and Ready to merge, concepts left out. */
  needsYou: Item[];
  inFlight: Item[];
  concepts: Item[];
  queued: Item[];
  list: Item[];
  /** One per configured repository and any other repository a List item has, the most items in List first (ties in
   *  configured order); each group's items in board order. The List modal and the title bar's Scope menu
   *  both show them in this order. */
  listGroups: ListGroup[];
  /** Closed in the last 7 days, most recently closed first. */
  done: Item[];
}

/** Whether no repository is known to be onboarded or onboarding. Before the first read, beside a read error or a
 * repository left off the board, an empty repos isn't known to mean none. */
export function noneOnboarded(data: BoardData): boolean {
  return !data.repos.length && !data.onboarding?.length && !data.repositoryConfigProblems?.length && !data.error && data.fetchedAt !== null;
}

export function boardSections(data: BoardData, now: number): BoardSections {
  const items = [...data.items].sort(byFlowOrder);
  const inStatus = (...s: Status[]) => items.filter((i) => s.includes(i.status));
  const list = inStatus('List');
  const repos = data.repos.map((r) => r.repo);
  for (const i of list) if (!repos.some((r) => sameRepo(r, repoKey(i)))) repos.push(repoKey(i));
  const listGroups = repos
    .map((repo) => ({ repo, name: repoName(repo, data.repos), id: listGroupId(repo), items: data.items.filter((i) => i.status === 'List' && inRepo(i, repo)) }))
    .sort((a, b) => b.items.length - a.items.length);
  const notConcept = (i: Item) => i.kind !== 'concept';
  return {
    needsYou: inStatus('Ready', 'Needs you', 'Verify', 'Ready to merge').filter(notConcept),
    inFlight: inStatus('Shaping', 'Ready', 'In progress', 'Review').filter(notConcept),
    concepts: items.filter((i) => i.kind === 'concept' && i.status !== 'Done'),
    queued: inStatus('Queued'),
    list,
    listGroups,
    done: items
      .filter((i) => isRecentlyDone(i, now))
      .sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt)),
  };
}

/** A concept's open child work on the board, in flow order. */
export function conceptChildren(concept: Item, items: readonly Item[]): Item[] {
  return items
    .filter((i) => i.parentId === concept.id && i.status !== 'Done' && i.state === 'open')
    .sort(byFlowOrder);
}

export const HINTS: Partial<Record<Status, string>> = {
  'Needs you': 'Answer in its T3 thread',
  Verify: 'Test it with the steps in the PR, then merge',
  'Ready to merge': 'Merge the PR',
};

/** An open PR's link text: its number, and draft or its state when not open. */
export function prLabel(pr: LinkedPr): string {
  return `PR #${pr.number}${pr.isDraft ? ' (draft)' : pr.state === 'open' ? '' : ` (${pr.state})`}`;
}

export const UNREADABLE = 'The T3 Code database could not be read';

/** What Abandon asks, and how the provider keeps the issue recoverable. */
export function abandonPrompt(item: Item): { question: string; detail: string; confirm: string; done: string } {
  const azure = onAzure(item.repo ?? '');
  return { question: `Abandon ${itemName(item)}?`, confirm: 'Abandon',
    detail: azure ? 'This moves the work item to Removed in Azure DevOps. You can reactivate it in Azure DevOps.'
      : 'This closes the issue as "not planned" on GitHub. You can reopen it on GitHub.',
    done: azure ? `Moved ${itemName(item)} to Removed.` : `Closed ${itemName(item)} as "not planned".`,
  };
}
