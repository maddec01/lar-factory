// The board's data model and the rules that place an item in the flow.
// Shared by the server and the browser, so it imports nothing.

export const STATUSES = [
  'List',
  'Queued',
  'Shaping',
  'Needs you',
  'Ready',
  'In progress',
  'Review',
  'Verify',
  'Ready to merge',
  'Done',
] as const;

export type Status = (typeof STATUSES)[number];

/** Statuses only Pedro can move on from. */
export const AMBER_STATUSES: readonly Status[] = ['Needs you', 'Verify'];

export type ContentType = 'Issue' | 'PullRequest' | 'DraftIssue';

export interface LinkedPr {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  /** The head commit's checks; null when it has none. */
  checks: Checks | null;
}

/** Counts over all of a PR's checks, required or not. */
export interface Checks {
  passed: number;
  failed: number;
  running: number;
  total: number;
  /** When the earliest running check started, or null if none has. */
  since: string | null;
}

export type CheckState = 'running' | 'passed' | 'failed';

/** Running checks past this long are shown amber, so a stuck runner gets noticed. */
export const SLOW_CHECKS_MS = 30 * 60 * 1000;

/** Another issue an item links to; it may or may not be on the board. */
export interface IssueRef {
  number: number;
  title: string;
  url: string;
  repo: string;
  state: 'OPEN' | 'CLOSED';
}

/** The first issues of a GitHub link list, and how many it holds in all. */
export interface IssueLinks {
  total: number;
  nodes: IssueRef[];
}

export interface Item {
  /** Project item id. */
  id: string;
  /** Status column. Items without one are treated as List. */
  status: Status;
  type: ContentType;
  number: number | null;
  title: string;
  url: string | null;
  repo: string | null;
  labels: string[];
  /** OPEN, CLOSED or MERGED; null for drafts. */
  state: string | null;
  parent: IssueRef | null;
  subIssues: { total: number; completed: number };
  /** Open blockers, for the card's badge. */
  blockedBy: number;
  /** GitHub's blocked-by links, open and closed. */
  blockers: IssueLinks;
  /** GitHub's blocking links: the issues this one blocks. */
  blocking: IssueLinks;
  updatedAt: string;
  closedAt: string | null;
  linkedPrs: LinkedPr[];
}

/** A T3 Code thread the board started. */
export interface StartedThread {
  threadId: string;
  title: string;
}

export interface RepoConfig {
  repo: string;
  platform: string;
}

export interface BoardData {
  /** Running code, independent of the GitHub project data's freshness. */
  codeUpdate?: CodeUpdate;
  /** Local write session; changes on restart so an old retry cannot recreate an issue. */
  capture?: { session: string; enabled: boolean };
  project: { title: string; url: string | null };
  repos: RepoConfig[];
  refreshSeconds: number;
  /** Time of the last successful read, or null if there has never been one. */
  fetchedAt: string | null;
  /** Error from the latest read if it failed; the items are then from fetchedAt. */
  error: string | null;
  items: Item[];
  /** Threads this board run started, by item id, so every page shows them. */
  started?: Record<string, StartedThread>;
  /** The latest update of this checkout, from the button or a terminal; null on boards that can't update. */
  update?: UpdateProgress | null;
}

export interface CodeUpdate {
  runningRevision: string | null;
  remoteRevision: string | null;
  behind: number | null;
  error: string | null;
  command: string;
  /** Whether this board can update itself: only the launch-agent board can. */
  updatable: boolean;
  /** Where the updater and the board write their logs. */
  logs: { update: string; board: string };
}

export const UPDATE_STEPS = ['check', 'fetch', 'install', 'restart', 'health', 'skills', 'profiles', 'done'] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];

/** An update's progress, kept outside the board's memory because the update restarts the board. */
export interface UpdateProgress {
  state: 'running' | 'done' | 'failed';
  /** The updater's process id, so a dead updater isn't shown as running. */
  pid: number;
  /** Steps that finished, in order. Skipped steps aren't listed. */
  finished: UpdateStep[];
  /** The step running now, or the one that failed. */
  current: UpdateStep | null;
  startedAt: string;
  finishedAt: string | null;
  /** The origin/main revision this update moves to, once fetched. */
  revision: string | null;
  error: string | null;
  /** The last lines of the update log when the update failed. */
  logTail: string | null;
}

export interface Counts {
  total: number;
  needsYou: number;
  inFlight: number;
  queued: number;
  list: number;
}

// ---------- kinds ----------

export type Kind =
  | 'bug'
  | 'feature'
  | 'improvement'
  | 'concept'
  | 'decision'
  | 'build'
  | 'draft'
  | 'pr'
  | 'issue';

export function decisionType(item: Item): string | null {
  const label = item.labels.find((l) => l.startsWith('decision:'));
  return label ? label.slice('decision:'.length).trim() : null;
}

export function kindOf(item: Item): Kind {
  const has = (l: string) => item.labels.includes(l);
  if (has('concept')) return 'concept';
  if (decisionType(item)) return 'decision';
  if (has('build')) return 'build';
  if (has('bug')) return 'bug';
  if (has('feature')) return 'feature';
  if (has('improvement')) return 'improvement';
  if (item.type === 'DraftIssue') return 'draft';
  if (item.type === 'PullRequest') return 'pr';
  return 'issue';
}

export function kindLabel(item: Item): string {
  const kind = kindOf(item);
  if (kind === 'decision') return `decision: ${decisionType(item)}`;
  if (kind === 'pr') return 'pull request';
  return kind;
}

/** The issue-type tabs of the flow diagram. */
export type Track = 'bug' | 'feat' | 'fog';

/**
 * Which flow-diagram path an item follows. Concepts, their decision and build
 * sub-issues follow the foggy path; bugs the bug path; everything else the
 * feature paths (small and visual can't be told apart from labels).
 */
export function trackOf(item: Item): Track {
  const kind = kindOf(item);
  if (kind === 'concept' || kind === 'decision' || kind === 'build') return 'fog';
  if (kind === 'bug') return 'bug';
  return 'feat';
}

// ---------- flow nodes ----------

export type FlowNode =
  | 'capture'
  | 'queue'
  | 'clear'
  | 'decisions'
  | 'foggy'
  | 'concept'
  | 'gate'
  | 'build'
  | 'review'
  | 'verify'
  | 'ready-to-merge'
  | 'merge';

/** The route box an item is shaped in, by kind. */
export function routeOf(item: Item): FlowNode {
  switch (kindOf(item)) {
    case 'bug':
      return 'clear';
    case 'concept':
      return 'foggy';
    case 'decision':
      return 'concept';
    default:
      return 'decisions';
  }
}

/** The flow node an item sits on, given its status. */
export function flowNodeOf(item: Item): FlowNode {
  switch (item.status) {
    case 'List':
      return 'capture';
    case 'Queued':
      return 'queue';
    case 'Shaping':
    case 'Needs you':
      return routeOf(item);
    case 'Ready':
      return 'gate';
    case 'In progress':
      return 'build';
    case 'Review':
      return 'review';
    case 'Verify':
      return 'verify';
    case 'Ready to merge':
      return 'ready-to-merge';
    case 'Done':
      return 'merge';
  }
}

// ---------- checks ----------

/** Running while any check runs, then failed if any failed, else passed. */
export function checkState(checks: Checks | null): CheckState | null {
  if (!checks) return null;
  if (checks.running) return 'running';
  return checks.failed ? 'failed' : 'passed';
}

export function isSlow(checks: Checks, now: number): boolean {
  if (checkState(checks) !== 'running' || !checks.since) return false;
  return now - Date.parse(checks.since) >= SLOW_CHECKS_MS;
}

// ---------- helpers ----------

export const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isRecentlyDone(item: Item, now: number): boolean {
  if (item.status !== 'Done') return false;
  const at = Date.parse(item.closedAt ?? item.updatedAt);
  return Number.isFinite(at) && now - at <= DONE_WINDOW_MS;
}

export function platformOf(item: Item, repos: readonly RepoConfig[]): string {
  if (!item.repo) return 'Draft';
  return repos.find((r) => r.repo === item.repo)?.platform ?? item.repo.split('/')[1] ?? item.repo;
}

export function ref(item: Item): string {
  return item.number === null ? 'draft' : `#${item.number}`;
}

/** Abandon deletes a List issue or removes a List draft. Pull requests stay. */
export function canAbandon(item: Item): boolean {
  return item.status === 'List' && (item.type === 'DraftIssue' || (item.type === 'Issue' && item.number !== null && item.repo !== null));
}

export function workCommand(item: Item): string | null {
  if (!item.repo || item.number === null) return null;
  return `/mux-work ${item.repo}#${item.number}`;
}

/** Whether the data is stale: the latest read failed, or none succeeded for 3 intervals. */
export function isStale(data: BoardData, now: number): boolean {
  if (data.error) return true;
  if (!data.fetchedAt) return true;
  return now - Date.parse(data.fetchedAt) > data.refreshSeconds * 3 * 1000;
}

export function countsOf(data: BoardData): Counts {
  const by = (statuses: readonly Status[], items = data.items) =>
    items.filter((i) => statuses.includes(i.status)).length;
  return {
    total: data.items.length,
    needsYou: by(['Needs you', 'Verify', 'Ready to merge']),
    // Concepts are shown in their own section, not In flight.
    inFlight: by(
      ['Shaping', 'Ready', 'In progress', 'Review'],
      data.items.filter((i) => kindOf(i) !== 'concept'),
    ),
    queued: by(['Queued']),
    list: by(['List']),
  };
}
