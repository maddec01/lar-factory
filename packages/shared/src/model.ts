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

/** A pull request's checks, and whether GitHub lets it merge. */
export interface Pipeline {
  /** The head commit's checks; null when it has none. */
  checks: Checks | null;
  mergeState: MergeState;
}

/** GitHub's merge state status, in four: CLEAN, HAS_HOOKS and UNSTABLE can merge; UNKNOWN is checking; DIRTY is conflicts; the rest blocked. */
export type MergeState = 'can merge' | 'checking' | 'blocked' | 'conflicts';

export interface LinkedPr extends Pipeline {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  /** The PR's description, for its item stats block; absent when not read (sample data). */
  body?: string;
  /** When the PR merged, to pick the latest merged PR's block; absent or null when not merged or not read. */
  mergedAt?: string | null;
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

/** An issue blocking an item, by GitHub's blocked-by link. */
export type Blocker = Pick<IssueRef, 'number' | 'repo' | 'state'>;

/** The issues the item is blocked by that are still open: what holds its start, its badge and Start after. */
export const openBlockers = (item: Pick<Item, 'blockers'>): Blocker[] => item.blockers.filter((b) => b.state === 'OPEN');

/** A blocker as `#n`, or as `owner/repo#n` when another repository's; `short` drops the owner, to fit on a button. */
export const blockerRef = (item: Pick<Item, 'repo'>, b: Pick<Blocker, 'number' | 'repo'>, short = false): string =>
  b.repo === item.repo ? `#${b.number}` : `${short ? b.repo.slice(b.repo.indexOf('/') + 1) : b.repo}#${b.number}`;

/** The item's open blockers, each as blockerRef gives it. */
export const openBlockerRefs = (item: Pick<Item, 'blockers' | 'repo'>, short = false): string[] =>
  openBlockers(item).map((b) => blockerRef(item, b, short));

/** Why the item can't start while an issue it's blocked by is open, naming the open ones; null once none is. */
export function blockedText(item: Pick<Item, 'blockers' | 'repo'>): string | null {
  const open = openBlockerRefs(item);
  return open.length ? `Blocked by ${open.join(', ')} until ${open.length > 1 ? 'they close' : 'it closes'}` : null;
}

/** The run that shows a concept works once every build lands: a title line, then numbered steps. */
export interface EndToEndCheck {
  title: string;
  steps: string[];
}

/** What a concept is for and where its shaping stands. */
export interface ConceptMap {
  /** The first paragraph under Destination. */
  destination: string;
  decisions: string[];
  /** What is still unknown, shown as open questions. */
  fog: string[];
  /** Absent when the body has no End-to-end check section. */
  check?: EndToEndCheck;
}

/** Where a build's slice stands; see `sliceProgress`. */
export type SliceProgress = 'done' | 'blocked' | 'active' | 'waiting';

/** One of a build's slices. */
export interface Slice extends IssueRef {
  progress: SliceProgress;
}

/** Which of the slice labels the board reads an issue carries. */
export interface SliceLabels {
  active?: boolean;
  /** An implementer couldn't finish it; it waits for a re-slice. Not GitHub's blocked-by link. */
  blocked?: boolean;
}

/**
 * Done once closed as completed, even if it still has a label; while open, blocked
 * with the `blocked` label, even if also `active`; active with the `active` label;
 * waiting otherwise. Null for a slice closed as not planned (or as a duplicate):
 * it's hidden and not counted.
 */
export function sliceProgress(state: 'OPEN' | 'CLOSED', stateReason: string | null, labels: SliceLabels): SliceProgress | null {
  if (state === 'CLOSED') return stateReason === 'NOT_PLANNED' || stateReason === 'DUPLICATE' ? null : 'done';
  return labels.blocked ? 'blocked' : labels.active ? 'active' : 'waiting';
}

/** An item's agent time, wall time, tokens and API cost, over every thread that worked on it. */
export interface ItemStats {
  /** Agent time: every agent's work, a child's only outside its direct parent's work, less waits on Pedro. */
  agentMs: number;
  /** Wall time: the time any of the item's agents was working, less waits on Pedro; absent in figures frozen before it existed. */
  wallMs?: number;
  /** Total tokens from the threads' transcripts, counted as T3 Code's usage page counts them. */
  tokens: number;
  /** API cost in dollars, as T3 Code's usage page prices the tokens; absent when nothing could be priced. */
  costUsd?: number;
  /** Read back from a merged PR's stats block: the figures as they stood at merge, cost in whole dollars (0 for under a dollar). */
  frozen?: true;
}

/**
 * An item's stats plus the item total of each of its sub-issues among `items`, each
 * item counted once. Wall time only when every figure has it; frozen only when all
 * are. Null when the sub-issues add nothing, so the total equals the item stats;
 * 'unavailable' when a figure couldn't be read.
 */
export function itemTotal(item: Item, items: readonly Item[]): ItemStats | 'unavailable' | null {
  const seen = new Set<string>([item.id]);
  const figures: (ItemStats | 'unavailable')[] = [];
  const add = (parent: Item) => {
    for (const child of items) {
      if (seen.has(child.id) || !isSubIssueOf(child, parent)) continue;
      seen.add(child.id);
      if (child.stats) figures.push(child.stats);
      add(child);
    }
  };
  add(item);
  if (!figures.length) return null;
  if (item.stats) figures.push(item.stats);
  if (figures.includes('unavailable')) return 'unavailable';
  const all = figures as ItemStats[];
  const own = item.stats as ItemStats | undefined;
  if (all.every((s) => s === own || (!s.agentMs && !s.wallMs && !s.tokens && !s.costUsd))) return null;
  const total: ItemStats = { agentMs: sum(all, (s) => s.agentMs), tokens: sum(all, (s) => s.tokens) };
  if (all.every((s) => s.wallMs !== undefined)) total.wallMs = sum(all, (s) => s.wallMs!);
  if (all.some((s) => s.costUsd !== undefined)) total.costUsd = sum(all, (s) => s.costUsd ?? 0);
  if (all.every((s) => s.frozen)) total.frozen = true;
  return total;
}

function isSubIssueOf(child: Item, parent: Item): boolean {
  return child.parent !== null && parent.repo !== null && child.parent.number === parent.number &&
    child.parent.repo.toLowerCase() === parent.repo.toLowerCase();
}

function sum(stats: readonly ItemStats[], figure: (s: ItemStats) => number): number {
  return stats.reduce((n, s) => n + figure(s), 0);
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
  /** GitHub's sub-issue counts; a build counts only its `build` sub-issues, not its slices. */
  subIssues: { total: number; completed: number };
  /** Every issue blocking this one, open or closed; empty for drafts and PRs. */
  blockers: Blocker[];
  updatedAt: string;
  closedAt: string | null;
  /** Empty for a pull request item, which has its own `pipeline`. */
  linkedPrs: LinkedPr[];
  /** A pull request item's own checks and merge state; absent on other items. */
  pipeline?: Pipeline;
  /** A build's slices, in GitHub's sub-issue order, less those closed as not planned. The project may auto-add them, but they're never board items. Empty for other issues. */
  slices: Slice[];
  /** A dossier's map, parsed from its issue body: always on a concept, and on an item with sub-issues on the board when its body has map sections; absent on other items. */
  map?: ConceptMap;
  /** Absent when no T3 thread worked on it or there's no T3 database; 'unavailable' when the database can't be read. */
  stats?: ItemStats | 'unavailable';
  /** Its item threads, newest first; absent when none or there's no T3 database, 'unavailable' when the database can't be read. */
  threads?: ItemThread[] | 'unavailable';
}

/** `running` while a turn is in flight, `needs you` while a runtime request is open, else `done`. */
export type ThreadState = 'running' | 'needs you' | 'done';

/** A T3 Code thread whose first user message names the item before any other issue. */
export interface ItemThread {
  id: string;
  title: string;
  state: ThreadState;
  /** The thread's latest message, turn or runtime request time. */
  updated: string;
}

/** The deep link that opens a T3 thread in T3 Code, as T3's promptLinks.ts parses it (pingdotgg/t3code d53873b6). */
export function threadLink(environmentId: string, threadId: string): string {
  return `t3code://threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

/** A T3 Code thread the board started. */
export interface StartedThread {
  threadId: string;
  title: string;
}

/** What starting a thread answered: the thread, or why it did not start. */
export interface StartResult {
  thread: StartedThread | null;
  error: string | null;
  /** The thread may have started; starting again could make a second one. */
  uncertain?: boolean;
}

/** A model Start offers: T3's name for it, else its slug. */
export interface ModelOption {
  slug: string;
  label: string;
}

/** An enabled T3 provider instance, named as T3's picker names it, and the models Start offers on it. */
export interface ModelGroup {
  instanceId: string;
  name: string;
  models: ModelOption[];
}

/** The provider instance and model a new thread runs on; none leaves it to T3 ("T3 default"). */
export interface ModelChoice {
  instanceId: string;
  model: string;
}

/** A blocked part's start, armed by Start after: the board starts it on this model choice once every issue it's blocked by closes. */
export interface ArmedStart {
  /** None leaves it to T3 ("T3 default"). */
  model?: ModelChoice;
}

/** Whether `groups` offer `choice`: its instance is there with that model. */
export function offers(groups: readonly ModelGroup[], choice: ModelChoice): boolean {
  return groups.some((g) => g.instanceId === choice.instanceId && g.models.some((m) => m.slug === choice.model));
}

export interface RepoConfig {
  repo: string;
  platform: string;
  /** Repository role: what this repository is to the others. */
  role: string;
}

export interface BoardData {
  /** Local write session; changes on restart so an old retry cannot recreate an issue. */
  capture?: { session: string; enabled: boolean };
  /** The GitHub Project: its owner, absent from older boards, and its title. */
  project: { owner?: string; title: string };
  repos: RepoConfig[];
  refreshSeconds: number;
  /** Time of the last successful read, or null if there has never been one. */
  fetchedAt: string | null;
  /** Error from the latest read if it failed; the items are then from fetchedAt. */
  error: string | null;
  items: Item[];
  /** The model choices Start offers besides "T3 default"; empty when T3's settings or model list can't be read. */
  modelChoices: ModelGroup[];
  /** Build threads this board run started, by hand or through Start after, by item id; kept apart from `started`'s refining threads. */
  startedBuilds?: Record<string, StartedThread>;
  /** Threads this board run started, by item id, so every page shows them. */
  started?: Record<string, StartedThread>;
  /** Starts armed by Start after, by item id, kept in the board server's data folder. Absent in sample mode. */
  armed?: Record<string, ArmedStart>;
  /** Why a start the board ran by itself failed, by item id; the part was disarmed. Arming or disarming it clears this. */
  armedErrors?: Record<string, string>;
  /** What's wrong with t3 and gh, from the latest lookup; a tool that works has no entry. Absent in sample mode. */
  tools?: ToolProblems;
  /** T3 Code's environment id, which thread links need; absent when T3 hasn't written one. */
  t3EnvironmentId?: string;
  /**
   * Per configured repository, null when Start build finds its repository project, else
   * the hint that says how to add it in T3. Absent until the first read, and in sample mode.
   */
  repositoryProjects?: Record<string, string | null>;
}

/** The hint for adding the repository's T3 project when a start can't find it, whatever the case; null when it can, or before the first read. */
export function repositoryProjectHint(data: Pick<BoardData, 'repositoryProjects'>, repo: string | null): string | null {
  const key = repo?.toLowerCase();
  return Object.entries(data.repositoryProjects ?? {}).find(([r]) => r.toLowerCase() === key)?.[1] ?? null;
}

/** A tool the lookup didn't find, naming the override that pointed nowhere, if one did. */
export type ToolMissing = { problem: 'missing'; override?: string };

/** A tool the board can't use: missing, or (gh only) logged out. */
export type ToolProblem = ToolMissing | { problem: 'logged-out' };

export interface ToolProblems {
  t3?: ToolMissing;
  gh?: ToolProblem;
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
  if (has('bug')) return 'bug';
  if (has('feature')) return 'feature';
  if (has('improvement')) return 'improvement';
  if (has('build')) return 'build';
  if (item.type === 'DraftIssue') return 'draft';
  if (item.type === 'PullRequest') return 'pr';
  return 'issue';
}

/** An issue that becomes one PR, delivered through its slices: the `build` label decides it, whatever the kind,
 *  except on a concept, whose sub-issues are items on the board. */
export function isBuild(item: Pick<Item, 'labels'>): boolean {
  return item.labels.includes('build') && !item.labels.includes('concept');
}

export function kindLabel(item: Item): string {
  const kind = kindOf(item);
  if (kind === 'decision') return `decision: ${decisionType(item)}`;
  if (kind === 'pr') return 'pull request';
  return kind;
}

// ---------- checks ----------

/** Running while any check runs, then failed if any failed, else passed. */
export function checkState(checks: Checks | null): CheckState | null {
  if (!checks) return null;
  if (checks.running) return 'running';
  return checks.failed ? 'failed' : 'passed';
}

/** The pipeline of the PR Open PR opens: the item's own when it is a pull request, else its first linked PR's; null when there is none. */
export function prPipeline(item: Pick<Item, 'type' | 'linkedPrs' | 'pipeline'>): Pipeline | null {
  return (item.type === 'PullRequest' ? item.pipeline : item.linkedPrs[0]) ?? null;
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

/** Shown on the Board: anything not Done, and Done items closed in the last 7 days. */
export function platformOf(item: Item, repos: readonly RepoConfig[]): string {
  if (!item.repo) return 'Draft';
  return repos.find((r) => r.repo === item.repo)?.platform ?? item.repo.split('/')[1] ?? item.repo;
}

export function ref(item: Item): string {
  return item.number === null ? 'draft' : `#${item.number}`;
}

/** Abandon deletes a List or Queued issue, or removes such a draft. Pull requests stay. */
export function canAbandon(item: Item): boolean {
  return (item.status === 'List' || item.status === 'Queued') && (item.type === 'DraftIssue' || (item.type === 'Issue' && item.number !== null && item.repo !== null));
}

/** Line 1 of the work message, which T3 titles the thread from. Null for a draft. */
export function workTitle(item: Item): string | null {
  if (!item.repo || item.number === null) return null;
  return `#${item.number} ${item.title}`;
}

/** The work message: `#<n> <title>`, then `$mux-work <owner/repo>#<n>`. Null for a draft. */
export function workMessage(item: Item): string | null {
  const title = workTitle(item);
  return title && `${title}\n$mux-work ${item.repo}#${item.number}`;
}

/**
 * The branch Start build's worktree takes: `<kind>/<n>-<slug>`, the kind `fix` for a bug,
 * `feat` for a feature or improvement, else `chore`. The slug is up to five words of the
 * title, lowercase and hyphen-joined, accents dropped and anything but a-z and 0-9 left out.
 * Null for a draft.
 */
export function buildBranch(item: Item): string | null {
  if (!item.repo || item.number === null) return null;
  const kind = kindOf(item);
  const prefix = kind === 'bug' ? 'fix' : kind === 'feature' || kind === 'improvement' ? 'feat' : 'chore';
  const words = item.title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean).slice(0, 5);
  return `${prefix}/${[item.number, ...words].join('-')}`;
}

/** Start build's message, naming the builder agent of the mux-work installed at `muxWork`. Null for a draft. */
export function buildMessage(item: Item, muxWork: string): string | null {
  if (!item.repo || item.number === null) return null;
  return `Build ${item.repo}#${item.number}. Read ${muxWork}/agents/builder.md and follow it.`;
}

/** Whether the data is stale: the latest read failed, or none succeeded for 3 intervals. A first read still running isn't. */
export function isStale(data: BoardData, now: number): boolean {
  if (data.error) return true;
  if (!data.fetchedAt) return false;
  return now - Date.parse(data.fetchedAt) > data.refreshSeconds * 3 * 1000;
}
