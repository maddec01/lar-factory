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

/** A status kept on an issue as a label: `status-` and its name in lowercase, with hyphens for spaces. Done has no label. */
export const statusLabel = (status: Exclude<Status, 'Done'>): string => `status-${status.toLowerCase().replaceAll(' ', '-')}`;

/** The statuses an issue's labels hold, in flow order. */
export const labelStatuses = (labels: readonly string[]): Status[] => STATUSES.filter((s) => s !== 'Done' && labels.includes(statusLabel(s)));

/**
 * Whether an open item carries more than one status, as a hand edit of an issue's labels can leave it. Nothing moves it
 * until the user keeps one. A closed item is Done, whatever labels it kept.
 */
export const carriesTwoStatuses = (item: { statuses: readonly Status[]; state: 'open' | 'closed' }): boolean =>
  item.state === 'open' && item.statuses.length > 1;

/** The statuses as words: "Shaping, Ready and Review". */
export const statusesText = (statuses: readonly Status[]): string => statuses.join(', ').replace(/, ([^,]*)$/, ' and $1');

/** Why an item carrying more than one status doesn't move, and what to do. */
export const keepOneText = (statuses: readonly Status[]): string => `This issue carries ${statusesText(statuses)}. Keep one to move it again.`;

/** Statuses only the user can move on from. */
export const AMBER_STATUSES: readonly Status[] = ['Needs you', 'Verify'];

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
  /** A merged PR is `merged`, not `closed`. */
  state: 'open' | 'closed' | 'merged';
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
  state: 'open' | 'closed';
}

/** An issue blocking an item, by GitHub's blocked-by link. */
export type Blocker = Pick<IssueRef, 'number' | 'repo' | 'state'>;

/** The issues the item is blocked by that are still open: what holds its start, its badge and Start after. */
export const openBlockers = (item: Pick<Item, 'blockers'>): Blocker[] => item.blockers.filter((b) => b.state === 'open');

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
  /** Agent time: every agent's work, a child's only outside its direct parent's work, less waits on the user. */
  agentMs: number;
  /** Wall time: the time any of the item's agents was working, less waits on the user; absent in figures frozen before it existed. */
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
  /** The node id of the issue, pull request or draft the item holds. */
  id: string;
  /** The status the board places it by: Done once it closed as done, else the first of `statuses` in flow order, else List. */
  status: Status;
  /** Every status the item carries on its provider, in flow order; empty when it has none. Never Done, which is never stored. */
  statuses: Status[];
  /** A ticket is an issue or work item; a Project draft is a ticket whose `repo` and `number` are null. */
  content: 'ticket' | 'pr';
  number: number | null;
  title: string;
  url: string | null;
  repo: string | null;
  labels: string[];
  /** A draft is open. */
  state: 'open' | 'closed';
  /** How a closed item closed: `done` when completed or merged, `not-planned` otherwise; null while open. */
  closedAs: 'done' | 'not-planned' | null;
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
  /** Its item source: the GitHub Project config.json names, the default, or the repository's issues. */
  items?: ItemSourceKind;
  /** Its show setting: every open item its item source lists, the default, or only the items that carry a status. */
  show?: ShowSetting;
}

export const ITEM_SOURCE_KINDS = ['project', 'issues'] as const;

export type ItemSourceKind = (typeof ITEM_SOURCE_KINDS)[number];

/** A skill or checklist the board app bundles: who wrote it, its licence and its source on GitHub. */
export interface BundledSkill {
  /** The folder name in `skills/`, or `references/<file>` for a checklist. */
  name: string;
  author: string;
  licence: string;
  /** The URL of its folder or file on GitHub. */
  source: string;
}

export const SHOW_SETTINGS = ['all', 'opted-in'] as const;

export type ShowSetting = (typeof SHOW_SETTINGS)[number];

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
  /** Every command check from the latest lookup. Absent before the first check and in sample mode. */
  tools?: ToolChecks;
  /** T3 Code's environment id, which thread links need; absent when T3 hasn't written one. */
  t3EnvironmentId?: string;
  /**
   * Per configured repository, null when Start build finds its repository project, else
   * the hint that says how to add it in T3. Absent until the first read, and in sample mode.
   */
  repositoryProjects?: Record<string, string | null>;
  /** The bundle's skills and checklists, read once at startup; empty when the server can't read them. */
  bundledSkills?: BundledSkill[];
}

/** The hint for adding the repository's T3 project when a start can't find it, whatever the case; null when it can, or before the first read. */
export function repositoryProjectHint(data: Pick<BoardData, 'repositoryProjects'>, repo: string | null): string | null {
  const key = repo?.toLowerCase();
  return Object.entries(data.repositoryProjects ?? {}).find(([r]) => r.toLowerCase() === key)?.[1] ?? null;
}

/** The commands the board checks; az only while a listed repository is on Azure DevOps. */
export type CheckedTool = 'gh' | 't3' | 'git' | 'jq' | 'curl' | 'az';

/** A check that passed: the command runs, with the version it printed if it did. */
type Passed = { result: 'ok'; version?: string };
/** A missing command, naming the override that pointed nowhere if one did. */
type Missing = { result: 'missing'; override?: string };

/**
 * gh's check: it runs; it's missing; it's logged out; it's older than GH_FLOOR; or its login has no `project`
 * scope, with `upgrade` set to the upgrade command when it's also older than GH_FLOOR.
 * `scopes: 'unread'` marks a gh whose scopes the board couldn't read, which blocks nothing.
 */
export type GhCheck =
  | Passed & { scopes?: 'unread' }
  | Missing & { fix: string }
  | { result: 'logged-out'; version?: string; fix: string }
  | { result: 'outdated'; version: string; fix: string; scopes?: 'unread' }
  | { result: 'no-project-scope'; version?: string; fix: string; upgrade?: string };

/** t3's check: it runs, it's missing, or T3 Code isn't running, so `t3` can't start threads. Its fix is to install or open T3 Code. */
export type T3Check = Passed | Missing | { result: 'not-running'; version?: string };

/** git's, jq's or curl's check: it runs, or it's missing. */
export type CommandCheck = Passed | Missing & { fix: string };

/** az's check: it runs, it's missing, it's logged out, or it has no `azure-devops` extension. */
export type AzCheck =
  | Passed
  | Missing & { fix: string }
  | { result: 'logged-out'; version?: string; fix: string }
  | { result: 'no-extension'; version?: string; fix: string };

/** The oldest gh lar-work's scripts run with: 2.94.0 added `--parent`, `--add-sub-issue` and `--blocked-by`. */
export const GH_FLOOR = '2.94.0';

/** Every check from one lookup; `az` is absent when no listed repository is on Azure DevOps, as then it isn't checked. `fix` is the command that fixes a failed check. */
export interface ToolChecks { gh: GhCheck; t3: T3Check; git: CommandCheck; jq: CommandCheck; curl: CommandCheck; az?: AzCheck }

/** Any command's check. */
export type ToolCheck = NonNullable<ToolChecks[CheckedTool]>;
/** A check that failed, of one command or of any. */
export type FailedCheck<C extends ToolCheck = ToolCheck> = Exclude<C, { result: 'ok' }>;

/** The tool's check if it failed; undefined when it passed, before the first check and in sample mode. */
export function failedCheck<N extends CheckedTool>(tools: ToolChecks | undefined, name: N): FailedCheck<NonNullable<ToolChecks[N]>> | undefined {
  const check = tools?.[name];
  // TypeScript can't narrow a generic indexed access (ToolChecks[N]) by `result`, so the cast restates it.
  return check && check.result !== 'ok' ? check as FailedCheck<NonNullable<ToolChecks[N]>> : undefined;
}

/** Where a repository's items come from: its GitHub Project, or its issues. */
export type ItemSource = 'project' | 'issues';

/** Every repository reads the GitHub Project until build #380 lets one read its issues. */
export function itemSource(_repo: RepoConfig): ItemSource {
  return 'project';
}

/**
 * Whether gh's check stops the board reading a repository whose items come from `source`: before the first
 * check, while gh is missing or logged out, and for a Project while the login has no `project` scope.
 */
export function ghBlocksRead(check: GhCheck | undefined, source: ItemSource): boolean {
  if (!check || check.result === 'missing' || check.result === 'logged-out') return true;
  return check.result === 'no-project-scope' && source === 'project';
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
  if (item.content === 'pr') return 'pr';
  if (isDraft(item)) return 'draft';
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

/** An item's pull request, the one Open PR opens: its link and its pipeline, each null while unknown. */
interface ItemPr {
  url: string | null;
  pipeline: Pipeline | null;
}

/** The item's pull request: itself when it is one, else the first PR it links; null when it links none. */
export function itemPr(item: Pick<Item, 'content' | 'url' | 'linkedPrs' | 'pipeline'>): ItemPr | null {
  if (item.content === 'pr') return { url: item.url, pipeline: item.pipeline ?? null };
  const pr = item.linkedPrs[0];
  return pr ? { url: pr.url, pipeline: pr } : null;
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

/** A ticket with no repository yet, such as a Project draft. */
export const isDraft = (item: Pick<Item, 'content' | 'repo' | 'number'>): boolean =>
  item.content === 'ticket' && (item.repo === null || item.number === null);

export function ref(item: Item): string {
  return item.number === null ? 'draft' : `#${item.number}`;
}

/** Abandon deletes a List or Queued issue, or removes such a draft. Pull requests stay. */
export function canAbandon(item: Item): boolean {
  return (item.status === 'List' || item.status === 'Queued') && item.content === 'ticket';
}

/** Line 1 of the work message, which T3 titles the thread from. Null for a draft. */
export function workTitle(item: Item): string | null {
  if (!item.repo || item.number === null) return null;
  return `#${item.number} ${item.title}`;
}

/** The work message: `#<n> <title>`, then `$lar-work <owner/repo>#<n>`. Null for a draft. */
export function workMessage(item: Item): string | null {
  const title = workTitle(item);
  return title && `${title}\n$lar-work ${item.repo}#${item.number}`;
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

/** Start build's message, naming the builder agent of the lar-work installed at `larWork`. Null for a draft. */
export function buildMessage(item: Item, larWork: string): string | null {
  if (!item.repo || item.number === null) return null;
  return `Build ${item.repo}#${item.number}. Read ${larWork}/agents/builder.md and follow it.`;
}

/** Whether the data is stale: the latest read failed, or none succeeded for 3 intervals. A first read still running isn't. */
export function isStale(data: BoardData, now: number): boolean {
  if (data.error) return true;
  if (!data.fetchedAt) return false;
  return now - Date.parse(data.fetchedAt) > data.refreshSeconds * 3 * 1000;
}
