// What the board page shows, as data and plain text: its sections, each status's hint, a PR's link text, and what
// Abandon, the ticket close after it and a Needs you choice ask.

import { STATUSES, activityUnavailable, inRepo, isRecentlyDone, onAzure, itemName, openQuestionThread, repoKey, repoName, sameRepo, workingAgain } from './model.ts';
import type { BoardData, Item, LinkedPr, NeedsYouOffer, Status } from './model.ts';
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
  /** The desk: Items awaiting action, including current shaping and concept questions. */
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

/** Whether this item's own question or status asks for an answer. */
export function needsAnswer(item: Item): boolean {
  return item.status === 'Needs you' || Boolean(openQuestionThread(item) &&
    (item.kind === 'concept' ? !['List', 'Queued', 'Done'].includes(item.status) : item.status === 'Shaping'));
}

/** `clientError` is the page's own failed read; the placement of Verify and Ready to merge items depends on it. */
export function boardSections(data: BoardData, now: number, clientError?: string | null): BoardSections {
  const unavailable = activityUnavailable(data, now, clientError);
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
    needsYou: items.filter((item) => needsAnswer(item) || (notConcept(item) && ['Ready', 'Verify', 'Ready to merge'].includes(item.status) && !workingAgain(item, unavailable))),
    inFlight: items.filter((item) => notConcept(item) && (['Shaping', 'Ready', 'In progress', 'Review'].includes(item.status) || workingAgain(item, unavailable))),
    concepts: items.filter((i) => i.recorded !== false && i.kind === 'concept' && i.status !== 'Done'),
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

export const UNREADABLE = 'Usage details are unavailable.';

/** Offers local abandonment with optional tracker closure. */
export function abandonPrompt(item: Item): { question: string; detail: string; confirm: string; done: string } {
  return { question: `Abandon ${itemName(item)}?`, confirm: 'Abandon', done: `Set ${itemName(item)} aside on this Mac.`,
    detail: item.number ? 'Abandon sets the work aside on this Mac and leaves its ticket open. Abandon and close ticket closes the ticket first.'
      : 'This sets the work aside on this Mac. It has no ticket, so nothing changes in its provider.',
  };
}

/** Confirms ticket closure for work set aside in Archive. */
export function closeTicketPrompt(item: Item): { question: string; detail: string; confirm: string; keep: string; done: string } {
  const azure = onAzure(item.repo ?? '');
  return { question: `Close the ticket of ${itemName(item)} too?`, keep: 'Keep it open',
    confirm: azure ? 'Move to Removed' : 'Close issue',
    detail: azure ? 'This moves the work item to Removed in Azure DevOps. You can reactivate it in Azure DevOps.'
      : 'This closes the issue as "not planned" on GitHub. You can reopen it on GitHub.',
    done: azure ? `Moved ${itemName(item)} to Removed.` : `Closed ${itemName(item)} as "not planned".`,
  };
}

/** The Needs you choices the board confirms with `needsYouPrompt`; Abandon asks with its own. */
export type NeedsYouAction = Exclude<NeedsYouOffer, 'set-aside'>;

/** What the notice's causes say stays true of the ticket. */
function ticketCauses(item: Item): string[] {
  return (item.needsYou?.causes ?? []).flatMap((cause) => {
    if (cause.type === 'ticket-closed') return ['Its ticket stays closed.'];
    if (cause.type === 'assignee-changed') return [`Its ticket stays with ${cause.to ?? 'no one'}.`];
    if (cause.type === 'ticket-missing') return ['Its ticket stays missing from its provider.'];
    return [];
  });
}

/**
 * What a Needs you choice asks before it happens: where the item goes and what it does to its ticket, PR, branch and
 * worktree. Only Mark as handled and a started thread remove free text, so the others say the notice stays for it.
 */
export function needsYouPrompt(item: Item, action: NeedsYouAction): { question: string; detail: string } {
  const name = itemName(item);
  const told = ticketCauses(item);
  const ticket = told.length ? told.join(' ') : item.number ? "Its ticket doesn't change." : 'It has no ticket.';
  const noThread = item.needsYou?.causes.some((cause) => cause.type === 'no-thread') ? 'No thread starts, so T3 still shows none for this work.' : '';
  const outcome = item.needsYou?.hasOtherNote ? 'The notice stays with only its other note, which you can then mark as handled.' : 'This notice goes away.';
  const sentences = (...parts: string[]) => parts.filter(Boolean).join(' ');
  switch (action) {
    case 'reopen-pr': return { question: `Reopen the PR of ${name}?`,
      detail: sentences(`This reopens its PR in its provider. The item stays at ${item.status}, and its branch and worktree don't change.`, ticket, noThread, outcome) };
    case 'replace-pr': return { question: `Start a replacement build for ${name}?`,
      detail: sentences('This moves the item to Ready, where Start build starts a new thread on a new branch from the same brief. Its closed PR stays closed, and its old branch and worktree stay.', ticket, noThread, outcome) };
    case 'keep-working': return { question: `Keep working on ${name}?`,
      detail: sentences(`The item stays on the desk at ${item.status}.`, ticket, "Its PR, branch and worktree don't change.", noThread, outcome) };
    case 'mark-handled': return { question: `Mark ${name} as handled?`, detail: sentences('This changes nothing except removing the notice.', ...told) };
    case 'start-again': {
      const build = item.needsYou?.startAgainPurpose === 'build';
      return { question: `Start ${name} again?`,
        detail: sentences(`This starts a new ${build ? 'build' : 'shaping'} thread in T3. The item stays at ${item.status}.`, ticket,
          build ? 'The board checks its PR, branch and worktree, then says what happens to them.' : "Its PR, branch and worktree don't change.",
          'Once T3 shows the thread, the notice goes away. If the start fails, the notice stays.') };
    }
    case 'back-to-queue': case 'back-to-list': {
      const queue = action === 'back-to-queue';
      return { question: queue ? `Move ${name} back to Queue?` : `Move ${name} to List?`,
        detail: sentences(`This moves the item to ${queue ? 'Queued' : 'List'}.`, item.kind === 'build' ? 'Its slices and build progress reset.' : '',
          told.length || !item.number ? `${ticket} Its PR doesn't change.` : "Its ticket and PR don't change.",
          'Its old branches and worktrees stay unless you choose to remove them next.', noThread, outcome) };
    }
  }
}
