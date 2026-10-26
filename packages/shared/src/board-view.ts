// What the board page shows, as data and plain text: its sections, each status's hint, a PR's link text, and what
// Abandon asks.

import { STATUSES, isDraft, isRecentlyDone, kindOf, ref, repoKey, repoName, sameRepo } from './model.ts';
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
  /** The repository's `owner/name`, or Draft. */
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
  /** One per configured repository, then any other repository a List item has, then Draft; each group's items in board order. */
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
  const notConcept = (i: Item) => kindOf(i) !== 'concept';
  return {
    needsYou: inStatus('Ready', 'Needs you', 'Verify', 'Ready to merge').filter(notConcept),
    inFlight: inStatus('Shaping', 'Ready', 'In progress', 'Review').filter(notConcept),
    concepts: items.filter((i) => kindOf(i) === 'concept' && i.status !== 'Done'),
    queued: inStatus('Queued'),
    list,
    listGroups: repos.map((repo) => ({
      repo, name: repoName(repo, data.repos), id: listGroupId(repo), items: data.items.filter((i) => i.status === 'List' && sameRepo(repoKey(i), repo)),
    })),
    done: items
      .filter((i) => isRecentlyDone(i, now))
      .sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt)),
  };
}

/** A concept's open sub-issues on the board, in flow order. */
export function conceptChildren(concept: Item, items: readonly Item[]): Item[] {
  return items
    .filter(
      (i) =>
        i.parent &&
        i.parent.repo === concept.repo &&
        i.parent.number === concept.number &&
        i.status !== 'Done' &&
        i.state === 'open',
    )
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

/** What Abandon asks before it deletes, and what it says after. */
export function abandonPrompt(item: Item): { question: string; detail: string; confirm: string; done: string } {
  return isDraft(item)
    ? { question: `Remove draft ${item.title}?`, detail: "This removes the draft from the project. It can't be undone.",
        confirm: 'Remove draft', done: `Removed draft ${item.title}.` }
    : { question: `Delete ${ref(item)} ${item.title}?`, detail: `This permanently deletes the issue from ${item.repo} on GitHub. It can't be undone.`,
        confirm: 'Delete issue', done: `Deleted ${ref(item)} ${item.title}.` };
}
