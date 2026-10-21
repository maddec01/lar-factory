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
}

export interface ParentRef {
  number: number;
  title: string;
  url: string;
  repo: string;
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
  parent: ParentRef | null;
  subIssues: { total: number; completed: number };
  blockedBy: number;
  updatedAt: string;
  closedAt: string | null;
  linkedPrs: LinkedPr[];
}

export interface RepoConfig {
  repo: string;
  platform: string;
}

export interface BoardData {
  project: { title: string; url: string | null };
  repos: RepoConfig[];
  refreshSeconds: number;
  /** Time of the last successful read, or null if there has never been one. */
  fetchedAt: string | null;
  /** Error from the latest read if it failed; the items are then from fetchedAt. */
  error: string | null;
  items: Item[];
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
