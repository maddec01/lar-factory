// What the Board view shows, as data and plain text: its sections, each card's hint, badge texts
// and titles, and what Abandon asks. Both the React page (apps/web/src/board/board-view.tsx) and the text-built template use it.

import { AMBER_STATUSES, STATUSES, checkState, isRecentlyDone, isSlow, kindOf, platformOf, ref } from './model.ts';
import type { BoardData, Item, ItemStats, LinkedPr, Slice, SliceProgress, Status } from './model.ts';
import { duration, elapsed, formatTokens, formatUsd, plural, slug, wholeUsd } from './format.ts';

export function byFlowOrder(a: Item, b: Item): number {
  return (
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    (a.repo ?? '').localeCompare(b.repo ?? '') ||
    (a.number ?? 0) - (b.number ?? 0)
  );
}

export function listGroupId(platform: string): string {
  return `list-${slug(platform)}`;
}

/** The colour of a status: amber when it waits on Pedro, green once done, else the current step's. */
export function statusTone(status: Status): 'amber' | 'done' | 'now' {
  return AMBER_STATUSES.includes(status) ? 'amber' : status === 'Done' ? 'done' : 'now';
}

export interface ListGroup {
  platform: string;
  id: string;
  items: Item[];
}

export interface BoardSections {
  needsYou: Item[];
  inFlight: Item[];
  concepts: Item[];
  queued: Item[];
  list: Item[];
  /** One per configured repo's platform, then any other platform a List item has. */
  listGroups: ListGroup[];
  /** Closed in the last 7 days, most recently closed first. */
  done: Item[];
}

export function boardSections(data: BoardData, now: number): BoardSections {
  const items = [...data.items].sort(byFlowOrder);
  const inStatus = (...s: Status[]) => items.filter((i) => s.includes(i.status));
  const list = inStatus('List');
  const platforms = [...data.repos.map((r) => r.platform)];
  for (const i of list) {
    const p = platformOf(i, data.repos);
    if (!platforms.includes(p)) platforms.push(p);
  }
  return {
    needsYou: inStatus('Needs you', 'Verify', 'Ready to merge'),
    inFlight: inStatus('Shaping', 'Ready', 'In progress', 'Review').filter((i) => kindOf(i) !== 'concept'),
    concepts: items.filter((i) => kindOf(i) === 'concept' && i.status !== 'Done'),
    queued: inStatus('Queued'),
    list,
    listGroups: platforms.map((platform) => ({ platform, id: listGroupId(platform), items: list.filter((i) => platformOf(i, data.repos) === platform) })),
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
        i.state !== 'CLOSED' &&
        i.state !== 'MERGED',
    )
    .sort(byFlowOrder);
}

export const HINTS: Partial<Record<Status, string>> = {
  'Needs you': 'Answer in its T3 thread',
  Verify: 'Test it with the steps in the PR, then merge',
  'Ready to merge': 'Merge the PR',
};

/** The popover lists blocked slices first, then active, waiting and done. */
const SLICE_GROUPS: SliceProgress[] = ['blocked', 'active', 'waiting', 'done'];

/** The slice states the line under a build's bars names, in order. */
const NAMED_SLICES = ['blocked', 'active'] as const;

/** The blocked and the active slices, each group only when it has any. */
export function namedSlices(slices: readonly Slice[]): { progress: (typeof NAMED_SLICES)[number]; slices: Slice[] }[] {
  return NAMED_SLICES.map((progress) => ({ progress, slices: slices.filter((s) => s.progress === progress) })).filter((g) => g.slices.length);
}

/** Within each group, slices keep GitHub's sub-issue order. */
export function popoverOrder(slices: readonly Slice[]): Slice[] {
  return SLICE_GROUPS.flatMap((g) => slices.filter((s) => s.progress === g));
}

/** An open PR's link text: its number, and draft or its state when not open. */
export function prLabel(pr: LinkedPr): string {
  return `PR #${pr.number}${pr.isDraft ? ' (draft)' : pr.state === 'OPEN' ? '' : ` (${pr.state.toLowerCase()})`}`;
}

export interface ChecksBadge {
  className: string;
  title: string;
  text: string;
  /** Running for over 30 minutes; screen readers hear it after the text. */
  slow: boolean;
}

/** The badge after an open PR's link: running with counts and age, passed, failed, or nothing. */
export function checksBadge(pr: LinkedPr, now: number): ChecksBadge | null {
  const checks = pr.checks;
  const state = checkState(checks);
  if (!checks || !state || pr.state !== 'OPEN') return null;
  if (state === 'passed') return { className: 'checks passed', title: `All ${plural(checks.total, 'check')} passed`, text: 'checks passed', slow: false };
  if (state === 'failed') return { className: 'checks failed', title: `${checks.failed} of ${plural(checks.total, 'check')} failed`, text: 'checks failed', slow: false };
  const slow = isSlow(checks, now);
  const title = `Checks running${slow ? ' for over 30 minutes' : ''}: ${checks.passed} of ${checks.total} passed, ${checks.running} running${checks.failed ? `, ${checks.failed} failed` : ''}`;
  const age = checks.since ? ` · ${elapsed(checks.since, now)}` : '';
  return { className: `checks running${slow ? ' slow' : ''}`, title, text: `checks ${checks.passed}/${checks.total}${age}`, slow };
}

export const UNREADABLE = 'The T3 Code database could not be read';

/** The tooltip sentence for figures read back from merged PRs; '' for live ones. */
function frozenNote(stats: ItemStats): string {
  return stats.frozen ? ` Frozen when the PR merged, times rounded${stats.costUsd !== undefined ? ', cost to the nearest dollar' : ''}.` : '';
}

/** What the item stats badge's figures mean. */
export function statsTitle(stats: ItemStats): string {
  return "Σ is agent time: all agents' work, parallel work added up, less waits on you." +
    (stats.wallMs === undefined ? '' : ' Wall is the time any agent was working, less waits on you.') +
    " Tokens are counted as T3 Code's usage page counts them." +
    (stats.costUsd !== undefined ? ' The cost is an API estimate at list prices, not the subscription bill.' : '') + frozenNote(stats);
}

/** What the total badge adds up. */
export function totalTitle(total: ItemStats): string {
  return 'The total adds the item stats of this item and of its sub-issues on the board, each once: ' +
    'agent time first, then wall time, tokens and API cost, as in the item stats. ' +
    'Times are added up across sub-issues, wall time too, so builds that ran side by side count in full.' + frozenNote(total);
}

/** Agent time, wall time when known, tokens and cost when priced; a frozen cost in whole dollars. */
export function figures(stats: ItemStats): string {
  const wall = stats.wallMs === undefined ? '' : ` · wall ${duration(stats.wallMs)}`;
  const cost = stats.costUsd === undefined ? '' : ` · ${stats.frozen ? wholeUsd(stats.costUsd) : formatUsd(stats.costUsd)}`;
  return `${duration(stats.agentMs)}${wall} · ${formatTokens(stats.tokens)}${cost}`;
}

/** What Abandon asks before it deletes, and what it says after. */
export function abandonPrompt(item: Item): { question: string; detail: string; confirm: string; done: string } {
  return item.type === 'DraftIssue'
    ? { question: `Remove draft ${item.title}?`, detail: "This removes the draft from the project. It can't be undone.",
        confirm: 'Remove draft', done: `Removed draft ${item.title}.` }
    : { question: `Delete ${ref(item)} ${item.title}?`, detail: `This permanently deletes the issue from ${item.repo} on GitHub. It can't be undone.`,
        confirm: 'Delete issue', done: `Deleted ${ref(item)} ${item.title}.` };
}
