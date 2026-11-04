// The board's data model and the rules that place an item in the flow.
// Shared by the server and the browser, so it imports nothing but types.

import type { KindDisagreement } from './kind-disagreement.ts';
import type { EffectiveVocabulary, VocabularyMapping, VocabularySources } from './vocabulary.ts';

import type { SkillStatus } from './install-skills.ts';

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

export const STATUS_LABEL_PREFIX = 'status-';

/** A status kept on an issue as a label: `status-` and its name in lowercase, with hyphens for spaces. Done has no label. */
export const statusLabel = (status: Exclude<Status, 'Done'>): string => `${STATUS_LABEL_PREFIX}${status.toLowerCase().replaceAll(' ', '-')}`;

/** The statuses an issue's labels hold, in flow order. */
export const labelStatuses = (labels: readonly string[]): Status[] => STATUSES.filter((s) => s !== 'Done' && labels.includes(statusLabel(s)));

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
  /** Azure source commit observed with this PR. */
  sourceRevision?: string;
  number: number;
  url: string;
  /** A merged PR is `merged`, not `closed`. */
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  /** The PR's description, for its item stats block; absent when not read (sample data). */
  body?: string;
  /** When the PR merged, to pick the latest merged PR's block; absent or null when not merged or not read. */
  mergedAt?: string | null;
  /** Known only from the work record, so its checks, merge state and draft flag are placeholders nothing read. */
  pipelineUnread?: true;
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

/** Azure's native work item fields, alongside the factory status. */
export interface AzureWorkItem {
  type: string;
  state: string;
  assignee: string | null;
}

/** Another issue an item links to; it may or may not be on the board. */
export interface IssueRef {
  number: number;
  title: string;
  url: string;
  repo: string;
  state: 'open' | 'closed';
  azure?: AzureWorkItem;
}

/** What the latest read of a Dependency's ticket or PR showed. A read that failed or lost access is a kind of its own. */
export const DEPENDENCY_OBSERVATION_KINDS = ['open', 'closed', 'merged', 'reopened', 'deleted', 'access-lost', 'read-failed'] as const;
export type DependencyObservationKind = (typeof DEPENDENCY_OBSERVATION_KINDS)[number];
/** Each kind of read as the board says it. */
export const DEPENDENCY_OBSERVATION_WORDS: Record<DependencyObservationKind, string> = {
  open: 'open', closed: 'closed', merged: 'merged', reopened: 'reopened', deleted: 'deleted', 'access-lost': 'access lost', 'read-failed': 'read failed',
};

/** A Dependency holding a build: a change the team or repository that owns it delivers. Only the user's met mark releases it. */
export interface DependencyHold {
  dependencyId: string;
  /** The Dependency's revision, which a met mark or its reversal names. */
  revision: number;
  /** The repository or team that owns and delivers the change. */
  owner: string;
  need: string;
  ticket: string | null;
  /** Its ticket, then each of its PRs, with the page that shows it; empty when it names neither and is a handover only. */
  named: { reference: string; url: string }[];
  /** What will establish that the change was delivered; empty until agreed. */
  evidence: string;
  met: { by: string; at: string } | null;
  /** Whether an observation changed after it was marked met. */
  needsReview: boolean;
  /** The most recent read of its ticket or one of its PRs, or null before any. It never sets or clears the mark. */
  observation: {
    subject: string; kind: DependencyObservationKind; detail: string | null; observedAt: string;
    /** The last read that answered, kept beside a read that failed or lost access; null after a read that answered. */
    lastGood: { kind: DependencyObservationKind; observedAt: string } | null;
  } | null;
}

/**
 * Work blocking an item: closed once its work record's local facts complete it. A record's blocker names its work ID and
 * title; its number is 0 without a ticket. A Dependency's blocker carries `dependency` and is closed once marked met.
 */
export type Blocker = Pick<IssueRef, 'number' | 'repo' | 'state'> & { workId?: string; title?: string; dependency?: DependencyHold };

/** The blockers whose work isn't complete yet, or whose Dependency isn't marked met: what holds its start, its badge and Start after. */
export const openBlockers = (item: Pick<Item, 'blockers'>): Blocker[] => item.blockers.filter((b) => b.state === 'open');

/**
 * A blocker as `#n`, or as `owner/repo#n` when another repository's; `short` drops the owner, to fit on a button. A
 * Dependency goes by its owner.
 */
export const blockerRef = (item: Pick<Item, 'repo'>, b: Pick<Blocker, 'number' | 'repo' | 'title' | 'dependency'>, short = false): string =>
  b.dependency ? short ? b.dependency.owner : `Dependency on ${b.dependency.owner}`
    : !b.number ? b.title ?? 'untracked work' : b.repo === item.repo ? `#${b.number}` : `${short ? b.repo.slice(b.repo.indexOf('/') + 1) : b.repo}#${b.number}`;

/** The item's open blockers, each as blockerRef gives it. */
export const openBlockerRefs = (item: Pick<Item, 'blockers' | 'repo'>, short = false): string[] =>
  openBlockers(item).map((b) => blockerRef(item, b, short));

/**
 * The blockers in the two groups the board names, `blockers` defaulting to the item's open ones: the work that must
 * complete, as `#12, #13`, and the Dependencies the user must mark met, as `the Dependency on acme/auth`. Each says
 * whether it names more than one; a group with none is null.
 */
export function blockerGroups(item: Pick<Item, 'blockers' | 'repo'>, blockers = openBlockers(item)) {
  const work = blockers.filter((b) => !b.dependency).map((b) => blockerRef(item, b));
  const owners = blockers.flatMap((b) => (b.dependency ? [b.dependency.owner] : []));
  return {
    work: work.length ? { names: work.join(', '), many: work.length > 1 } : null,
    dependencies: owners.length ? { names: `the ${owners.length > 1 ? 'Dependencies' : 'Dependency'} on ${owners.join(', ')}`, many: owners.length > 1 } : null,
  };
}

/** Why the item can't start while a blocker's work isn't complete or a Dependency isn't met, naming each; null once none is left. */
export function blockedText(item: Pick<Item, 'blockers' | 'repo'>): string | null {
  const { work, dependencies } = blockerGroups(item);
  const parts = [
    ...work ? [`${work.names} until ${work.many ? 'they complete' : 'it completes'}`] : [],
    ...dependencies ? [`${dependencies.names} until you mark ${dependencies.many ? 'them' : 'it'} met`] : [],
  ];
  return parts.length ? `Blocked by ${parts.join(', and by ')}` : null;
}

/**
 * What the board asks the user about a Dependency: to review a met mark whose observation changed since, or to mark an
 * unmet one met when its ticket closed or a PR merged. Null when nothing asks. The board never changes the mark itself.
 */
export function dependencyNotice(d: DependencyHold): string | null {
  const seen = d.observation;
  if (!seen) return null;
  const subject = `Its ${seen.subject === d.ticket ? 'ticket' : 'PR'} ${seen.subject}`;
  if (d.met) return d.needsReview ? `${subject} changed to ${DEPENDENCY_OBSERVATION_WORDS[seen.kind]} after you marked it met. Review the mark.` : null;
  return seen.kind === 'closed' || seen.kind === 'merged' ? `${subject} is ${seen.kind}. Mark it met once the change is delivered.` : null;
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
  /** The unmet Dependencies holding the concept's builds, the Map's bullets; absent when it lists none. */
  dependencies?: string[];
}

/** Where a build's slice stands; see `sliceProgress`. */
export type SliceProgress = 'done' | 'blocked' | 'active' | 'unknown' | 'waiting';

/** One of a build's slices. */
export interface Slice extends IssueRef {
  progress: SliceProgress;
  /** Its work record's ID; a private slice has no ticket number, so this tells slices apart. */
  workId?: string;
}

/**
 * A slice ticket's progress: done once closed as completed, waiting while open. Null for a slice closed as not planned
 * (or as a duplicate): it's hidden and not counted. A work record holds a slice's active and blocked progress.
 */
export function sliceProgress(state: 'OPEN' | 'CLOSED', stateReason: string | null): SliceProgress | null {
  if (state === 'CLOSED') return stateReason === 'NOT_PLANNED' || stateReason === 'DUPLICATE' ? null : 'done';
  return 'waiting';
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
  /** Read before every needed thread was observed, so a shared record may sit on the wrong item. Shown, but never retained, frozen or written to a PR. */
  provisional?: true;
  /** On a total only: a member is loading or failed, so these are the known figures, not the whole sum. */
  incomplete?: true;
}

const hasNoFigures = (s: ItemStats) => !s.agentMs && !s.wallMs && !s.tokens && !s.costUsd;

/**
 * Whether an item's usage is still to come or failed. Figures frozen at merge are complete, and an item with no threads
 * has none to wait for.
 */
export function usageIncomplete(item: Item): boolean {
  const { stats, threads, usageState } = item;
  if (typeof stats === 'object' && stats.frozen) return false;
  if (Array.isArray(threads) && !threads.length) return false;
  if (stats === 'unavailable' || usageState === 'loading' || usageState === 'failed') return true;
  return !usageState && !stats && (threads === 'unavailable' || !!threads?.length);
}

/** Whether an item's incomplete usage failed, rather than still loading: T3 stopped, or a read of it failed. */
export const usageFailed = (item: Item): boolean => usageIncomplete(item)
  && (item.stats === 'unavailable' || item.usageState === 'failed' || item.threads === 'unavailable' && item.usageState !== 'loading');

/** The item's sub-issues among `items`, and theirs, each once. */
export function itemMembers(item: Item, items: readonly Item[]): Item[] {
  const seen = new Set<string>([item.id]);
  const members: Item[] = [];
  const add = (parent: Item) => {
    for (const child of items) {
      if (seen.has(child.id) || !isSubIssueOf(child, parent)) continue;
      seen.add(child.id);
      members.push(child);
      add(child);
    }
  };
  add(item);
  return members;
}

/**
 * An item's stats plus the item total of each of its sub-issues among `items`, each
 * item counted once. Wall time only when every figure has it; frozen only when all
 * are. Null when the sub-issues add nothing, so the total equals the item stats. A
 * member whose usage is incomplete marks the total incomplete, and makes it
 * 'unavailable' when it has no figures to add.
 */
export function itemTotal(item: Item, items: readonly Item[]): ItemStats | 'unavailable' | null {
  const members = itemMembers(item, items);
  if (!members.length) return null;
  members.push(item);
  const incomplete = members.filter(usageIncomplete);
  if (incomplete.some((m) => !m.stats || m.stats === 'unavailable' || hasNoFigures(m.stats))) return 'unavailable';
  const all = members.flatMap((m) => (m.stats && m.stats !== 'unavailable' ? [m.stats] : []));
  if (!incomplete.length && all.every((s) => s === item.stats || hasNoFigures(s))) return null;
  const total: ItemStats = { agentMs: sum(all, (s) => s.agentMs), tokens: sum(all, (s) => s.tokens) };
  if (all.every((s) => s.wallMs !== undefined)) total.wallMs = sum(all, (s) => s.wallMs!);
  if (all.some((s) => s.costUsd !== undefined)) total.costUsd = sum(all, (s) => s.costUsd ?? 0);
  if (all.every((s) => s.frozen)) total.frozen = true;
  if (incomplete.length) total.incomplete = true;
  return total;
}

function isSubIssueOf(child: Item, parent: Item): boolean {
  return child.parentId === parent.id;
}

function sum(stats: readonly ItemStats[], figure: (s: ItemStats) => number): number {
  return stats.reduce((n, s) => n + figure(s), 0);
}

export interface Item {
  /** Local completion facts, independent of the board Status and absent on provider-only items. Never published. */
  completion?: { complete: boolean; reasons: string[] };
  refinement?: { complete: boolean; reasons: string[] };
  specSync?: { pending: boolean; error: string | null; warning: string | null };
  sync?: { state: 'saved' | 'pending' | 'error' | 'conflict'; message?: string };
  /** Public tracker structure, also present before this machine queues the issue. */
  tracker?: import('./tracker-structure.ts').TrackerStructure;
  /** False for an issue from the list that has no local work record yet. */
  recorded?: boolean;
  /** Eligibility from the durable journal, independent of Status. Absent for decisions and slices. */
  passingBrief?: boolean;
  publication?: Pick<import('./publication.ts').PublicationReadiness, 'eligible' | 'reasons'> & { recoverable?: boolean };
  /**
   * The board item's work ID, from its work record. An item source's read, before it joins a record, holds its ticket's
   * node id here, which the provider reads and writes it by.
   */
  id: string;
  /** Its work record's revision, which a move names; 0 on an item source's read. */
  revision: number;
  /** Its work record's Status. An item source's read places it by labels: Done once closed as done, else the first of `statuses`, else List. */
  status: Status;
  /** Every status the item carries, in flow order; empty when it has none. A work record carries its one Status. Never Done. */
  statuses: Status[];
  /** Its work record's kind, or on an item source's read the kind its labels give. */
  kind: Kind;
  /** The method in a local decision's body; null when no recognized method is written. */
  decisionMethod?: 'grill' | 'prototype' | 'research' | 'task' | null;
  /** A ticket is a repository issue or an Azure work item. */
  content: 'ticket';
  /** Its ticket's number, or 0 for work with no ticket. */
  number: number;
  title: string;
  /** Its ticket's URL, or null for work with no ticket. */
  url: string | null;
  repo: string;
  /**
   * An Azure work item with no repository tag: every repository reading its item source, whose Lists all show it, and
   * one of which Start runs in. `repo` is the first of them. Absent on every other item.
   */
  untaggedFor?: string[];
  /** Why Abandon can't run on the item, which its greyed-out Abandon shows: an Azure work item whose type has no Removed state. Absent when it can. */
  abandonRefusal?: string;
  labels: string[];
  /** Each label's colour on a tracker whose labels have one, by name, as CSS. Read with the labels, never stored on a record. */
  labelColors?: Record<string, string>;
  /** Its GitHub issue's type, read with the labels; absent when it has none. An Azure work item's is its `azure.type`. */
  issueType?: string;
  /** How its kind and its ticket's disagree; absent when they don't, or an answer ended the question. */
  kindDisagreement?: KindDisagreement;
  azure?: AzureWorkItem;
  /** Azure backlog priority position, retained through partial reads and UI sorting. */
  sourceOrder?: number;
  state: 'open' | 'closed';
  /**
   * Its ticket's assignees, sorted and comma-joined as a work record observes them, or null when it has none; absent
   * when the read didn't carry them. An Azure work item's is its `azure.assignee`.
   */
  assignee?: string | null;
  /** How a closed item closed: `done` when completed or merged, `not-planned` otherwise; null while open. */
  closedAs: 'done' | 'not-planned' | null;
  parent: IssueRef | null;
  /** The work ID of the record that owns it, or null while it has no parent. */
  parentId: string | null;
  /** Its child work's counts; on an item source's read, GitHub's sub-issue counts, a build counting only its `build` sub-issues. */
  subIssues: { total: number; completed: number };
  /** The team's current sprint and its direct children in that sprint; absent when no sprint is current. */
  currentSprint?: { name: string; childNumbers: number[] };
  /** Every issue blocking this one, open or closed. */
  blockers: Blocker[];
  updatedAt: string;
  closedAt: string | null;
  linkedPrs: LinkedPr[];
  /** A build's slices, in GitHub's sub-issue order, less those closed as not planned. They're never board items. Empty for other issues. */
  slices: Slice[];
  /** A dossier's map, parsed from its issue body: always on a concept, and on an item with sub-issues on the board when its body has map sections; absent on other items. */
  map?: ConceptMap;
  /** Absent when no T3 thread worked on it or there's no T3 database; 'unavailable' when the database can't be read. */
  stats?: ItemStats | 'unavailable';
  /**
   * Whether usage answers for this item's own thread family: current, loading while a thread was never read, or failed
   * until a read succeeds. Absent for an item with no threads, or before its first usage read.
   */
  usageState?: 'current' | 'loading' | 'failed';
  /**
   * The T3 threads its work record holds, newest first; absent when it holds none, 'unavailable' while T3 can't be read
   * and the board never saw one of them.
   */
  buildPhase?: string | null;
  threads?: ItemThread[] | 'unavailable';
  /**
   * Why it waits for its repository's changed item source or domain-doc location to be accepted in Settings, which
   * holds its starts; absent when no change affects it.
   */
  paused?: string;
  /**
   * Why its work record waits on the user, with what the board offers to do about it; absent when it doesn't wait.
   * `ticketOpen` says whether the last read showed its ticket open. `startAgainPurpose` is what Start again starts.
   */
  needsYou?: { reason: string; offers: NeedsYouOffer[]; causes: NeedsYouCause[]; ticketOpen: boolean; deletedThread?: boolean; startAgainPurpose?: 'shape' | 'build'; hasOtherNote?: boolean };
  /** Why the board couldn't clean up its shaping threads yet, which it keeps trying; shown in item details only. */
  shapingCleanupProblem?: string;
  /** Set on work off the board in Archive: set aside, which Restore brings back, or finished and hidden by retention. */
  archived?: { setAside: boolean; hidden: boolean; ticketOpen: boolean };
}

/** What the board offers for work that needs you. */
export const NEEDS_YOU_OFFERS = ['reopen-pr', 'replace-pr', 'keep-working', 'mark-handled', 'set-aside', 'start-again', 'back-to-queue', 'back-to-list'] as const;
export type NeedsYouOffer = (typeof NEEDS_YOU_OFFERS)[number];

/** A change the board saw that makes work wait on the user. `assignee-changed` holds who its ticket moved from and to, null for no one. */
export type NeedsYouCause =
  | { type: 'pr-closed' }
  | { type: 'ticket-closed' }
  | { type: 'assignee-changed'; from: string | null; to: string | null }
  | { type: 'ticket-missing' }
  | { type: 'no-thread' };

/** `running` during a turn, `needs you` at a request, `stopped` after an interrupted or failed turn, else `done`. */
export type ThreadState = 'running' | 'needs you' | 'stopped' | 'done';

/** A T3 Code thread whose first user message names the item before any other issue. */
export interface ItemThread {
  id: string;
  title: string;
  state: ThreadState;
  /** The thread's latest message, turn or runtime request time. */
  updated: string;
  /** Set while T3 can't be read: when the board last saw this state. */
  observedAt?: string;
  /** A running, waiting or queued descendant still belongs to this thread's work. */
  hasLiveChildren?: true;
  currentRunning?: true;
  /** T3 has queued this thread's next turn. Its state stays `done`. */
  queued?: true;
  /** T3 archived this thread. T3 opens New thread for an archived thread's link, so the board never links it. */
  archived?: true;
  /** A descendant is running, or this thread or a descendant has background tasks pending, so its work goes on after its turn ended. */
  hasRunningChildren?: true;
  /** Current descendant tasks: at most three titles, with the total count. Absent once they stop. */
  childActivity?: { titles: string[]; count: number };
  /** The work record's thread role, when recorded by the factory. */
  purpose?: string;
}

/** Whether the thread or a descendant is at work, waits on the user or has a queued turn. */
export const isLiveThread = (thread: ItemThread): boolean =>
  thread.state === 'running' || thread.state === 'needs you' || !!thread.queued || !!thread.hasLiveChildren;

/** Resume only an interrupted shaping session whose current thread family is known to have stopped. */
export function canResumeShaping(item: Item): boolean {
  if (item.status !== 'Shaping' || item.needsYou || !Array.isArray(item.threads) || !item.threads.length) return false;
  if (item.threads.some(thread => thread.observedAt || thread.hasLiveChildren || thread.state === 'running' || thread.state === 'needs you')) return false;
  const shaping = item.threads.filter(thread => thread.purpose === 'shape');
  return (shaping.length ? shaping : item.threads)[0]?.state === 'stopped';
}

/** Whether work a build delegated still runs, a slice's thread or a running child of its build thread, even after that thread's own run ended. */
export function delegatedWorkRunning(item: Item): boolean {
  return !!item.slices?.some((slice) => slice.progress === 'active') || !!currentBuildThread(item)?.hasRunningChildren;
}

/** Retry only a build moved to In progress whose current thread stopped before it recorded a build phase. */
export function canRetryBuild(item: Item): boolean {
  if (item.status !== 'In progress' || item.buildPhase || item.needsYou || delegatedWorkRunning(item) || !Array.isArray(item.threads)) return false;
  if (item.threads.some(thread => thread.observedAt || thread.hasLiveChildren || thread.state === 'running' || thread.state === 'needs you')) return false;
  return item.threads.find(thread => thread.purpose === 'build')?.state === 'stopped';
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

/** What a start's thread will do. */
export type StartPurpose = 'shape' | 'build';

/**
 * A start the server is running, one that left an unresolved launch intent and may have opened a thread, or one that
 * was refused or failed. A start with a thread has none.
 */
export type StartProgress =
  | { phase: 'starting' }
  | { phase: 'may-have-started' | 'failed'; message: string };

/** The item's start for `purpose` as the server sees it. */
export const startProgressOf = (data: Pick<BoardData, 'startProgress'>, itemId: string, purpose: StartPurpose): StartProgress | undefined =>
  data.startProgress?.[itemId]?.[purpose];

/** What starting a thread answered: the thread, or why it did not start. */
export interface StartResult {
  thread: StartedThread | null;
  error: string | null;
  /** The thread may have started; starting again could make a second one. */
  uncertain?: boolean;
  /** The skills with Drift, when Start build waits for the User to replace them or start anyway. */
  drift?: string[];
  /** The refusal passes by itself, as T3 or a read comes back, so Auto-build holds instead of pausing the build. */
  hold?: true;
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

/** The provider instance and model a new thread runs on; none leaves it to T3 ("T3 Project default"). */
export interface ModelChoice {
  instanceId: string;
  model: string;
}

/** One model option as T3 stores it, such as `effort: medium`. Options belong to one model. */
export interface ModelSelectionOption {
  id: string;
  value: string | boolean;
}

/** T3's full selection: a model choice with its options. Saved choices stay plain, so the board resolves options at launch. */
export interface ModelSelection extends ModelChoice {
  options?: ModelSelectionOption[];
}

/**
 * The T3 Project default entry's second line: the model and effort T3 will use, or nothing when that can't be read. T3 stores no
 * option for a value equal to the model's default, so T3 then uses that default, such as medium on Opus 5.5. The board
 * can't read it, so the line names the model alone. No effort here never means low.
 */
export function t3DefaultDetail(groups: readonly ModelGroup[], selection: ModelSelection | undefined): string | undefined {
  if (!selection) return undefined;
  const group = groups.find((g) => g.instanceId === selection.instanceId);
  const model = group?.models.find((m) => m.slug === selection.model)?.label ?? selection.model;
  const effort = selection.options?.find((o) => o.id === 'effort' || o.id === 'reasoningEffort')?.value;
  const name = `${group?.name ?? selection.instanceId} ${model}`;
  return typeof effort === 'string' ? `${name}, ${effort}` : name;
}

/** The T3 Project default of the item's repository, whatever the case. */
export function repositoryT3Default(data: Pick<BoardData, 't3Defaults'>, repo: string): ModelSelection | undefined {
  return Object.entries(data.t3Defaults ?? {}).find(([r]) => sameRepo(r, repo))?.[1];
}

/** A blocked part's start, armed by Start after: the board starts it on this model choice once every issue it's blocked by closes. */
export interface ArmedStart {
  /** None leaves it to T3 ("T3 Project default"). */
  model?: ModelChoice;
}

/** Whether `groups` offer `choice`: its instance is there with that model. */
export function offers(groups: readonly ModelGroup[], choice: ModelChoice): boolean {
  return groups.some((g) => g.instanceId === choice.instanceId && g.models.some((m) => m.slug === choice.model));
}

export interface RepoConfig {
  repo: string;
  /** Repository role: what this repository is to the others. */
  role: string;
  /** Its item source: GitHub repository issues or an Azure team's combined board. */
  items?: ItemSourceKind;
  /** The Azure DevOps team whose backlog and current sprint its item source is; absent for the other item sources. */
  team?: string;
  /** The labels a saved Custom labels setting holds. Settings no longer edit them, and the tracker holds the labels in use. */
  labels: string[];
  /** Settings saved on this machine. */
  setup?: RepositorySetup;
}

export const ITEM_SOURCE_KINDS = ['issues', 'azure-board'] as const;

export type ItemSourceKind = (typeof ITEM_SOURCE_KINDS)[number];

/** A skill or checklist the board app bundles: who wrote it, its licence and its source on GitHub. */
export interface BundledSkill {
  includedAuthors?: string[];
  notices?: string;
  /** The folder name in `skills/`, or `references/<file>` for a checklist. */
  name: string;
  author: string;
  licence: string;
  /** The URL of its folder or file on GitHub. */
  source: string;
  /** A Copy's Date in UPSTREAM.md, the day of the upstream commit it matches; absent for Lar's own. */
  date?: string;
  /** A skill's state in the install manifest; absent for a checklist, and before the first install that records it. */
  status?: SkillStatus;
}

/**
 * Why a repository's local settings need attention.
 */
export interface RepositoryConfigProblem {
  repo: string;
  problem: string;
}

/** Why the latest read left a repository's items off the board, and the command that fixes it, when one does. */
export interface ItemSourceProblem {
  repo: string;
  problem: string;
  fix?: string;
}

/**
 * What the first read is doing: `repositories` reads local repository settings, `items` reads their
 * items, and `finishing` reads what the board shows besides them. The page maps each id to its line of text.
 */
export type FirstReadStep = 'repositories' | 'items' | 'finishing';

/** The board server's first read of every repository since it started, and whether it has settled. */
export interface FirstRead {
  step: FirstReadStep;
  /** The item sources still being read, named by their repositories; each drops off as its read finishes. */
  running: string[];
  /**
   * The onboarded repositories whose items haven't landed yet, by owner/name, as their source still reads or waits for
   * its tool, once another repository's have; absent before any have and when none waits. The board shows the landed
   * repositories' items meanwhile.
   */
  waiting?: string[];
  /** Whether the read finished, failed, or gh blocked it. A settled first read stays settled until the server restarts. */
  settled: boolean;
  /** Available local work or a successful source allows access before all sources settle. */
  ready?: boolean;
}

/** The first read once it has settled, which is how sample mode starts. */
export const SETTLED_FIRST_READ: FirstRead = { step: 'finishing', running: [], settled: true };

/** The colors T3 lets a chosen project icon use. */
export const PROJECT_ICON_COLORS = ['gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'] as const;
export type ProjectIconColor = typeof PROJECT_ICON_COLORS[number];

/** The icon someone chose for a project in T3. */
export type ChosenProjectIcon =
  | { kind: 'lucide'; name: string; color: ProjectIconColor }
  | { kind: 'emoji'; emoji: string }
  | { kind: 'monogram'; text: string; color: ProjectIconColor };

/** A repository's icon: a favicon names the board's image by project and content revision, and no T3 path or URL reaches the page. */
export type ProjectIcon = { kind: 'favicon'; projectId: string; revision: string } | ChosenProjectIcon;

export interface BoardData {
  /** A local process problem; cached items remain available while it needs attention. */
  localProblem?: string;
  /** Sanitized authenticated source state. Credentials stay in the server. */
  t3Availability?: { availability: 'available' | 'unavailable' | 'renewal-required' | 'unsupported-version' | 'malformed'; observedAt?: string };
  /** The latest read of T3's usage figures, and when one last succeeded. While it fails, items keep the figures last seen. */
  usageRead?: { readable: boolean; readAt?: string | undefined };
  /** Local write session; changes on restart so an old retry cannot recreate an issue. */
  capture?: { session: string; enabled: boolean };
  repos: RepoConfig[];
  /** Repositories whose local settings need attention. */
  repositoryConfigProblems?: RepositoryConfigProblem[];
  /** Each onboarded repository whose items the latest read left off, such as one reading through a logged-out az, and why. */
  itemSourceProblems?: ItemSourceProblem[];
  /** The repositories on this Mac's list that are still onboarding, in the list's order. Absent in sample mode. */
  onboarding?: OnboardingRepository[];
  refreshSeconds: number;
  /** Time of the last successful read, or null if there has never been one. */
  fetchedAt: string | null;
  /** Error from the latest read if it failed; the items are then from fetchedAt. */
  error: string | null;
  items: Item[];
  /** The first read's progress; readiness allows access while remaining sources read. */
  firstRead: FirstRead;
  /** The model choices Start offers besides "T3 Project default"; empty when T3's settings or model list can't be read. */
  modelChoices: ModelGroup[];
  /** Each repository's effective T3 Project default, for the T3 Project default entry; a repository whose default can't be read has none. Absent in sample mode. */
  t3Defaults?: Record<string, ModelSelection>;
  /** Build threads this board run started, by hand or through Start after, by item id; kept apart from `started`'s refining threads. */
  startCheckFailures?: Record<string, string>;
  startedBuilds?: Record<string, StartedThread>;
  /** Threads this board run started, by item id, so every page shows them. */
  started?: Record<string, StartedThread>;
  /** Each item's start as the server sees it, by item id and purpose, so every page and a reload show it. */
  startProgress?: Record<string, Partial<Record<StartPurpose, StartProgress>>>;
  /** Starts armed by Start after, by item id, kept in the board server's data folder. Absent in sample mode. */
  armed?: Record<string, ArmedStart>;
  /** Why a start the board ran by itself failed, by item id; the part was disarmed. Arming or disarming it clears this. */
  armedErrors?: Record<string, string>;
  /** Every command check from the latest lookup. Absent before the first check and in sample mode. */
  tools?: ToolChecks;
  /**
   * The tool check's progress: the commands it is still checking, and the providers' tools it leaves out, as no listed
   * repository needs them. A command not yet known to be needed counts as checking. Absent before the first check and in
   * sample mode.
   */
  toolProgress?: ToolProgress;
  /** T3 Code's environment id, which thread links need; absent when T3 hasn't written one. */
  t3EnvironmentId?: string;
  /**
   * Per configured repository, null when Start build finds its repository project, else
   * the hint that says how to add it in T3. Absent until the first read, and in sample mode.
   */
  repositoryProjects?: Record<string, string | null>;
  /** The icon of each listed or onboarding repository with exactly one T3 project as its main checkout and an icon. Sample data holds chosen icons only, never a favicon. */
  projectIcons?: Record<string, ProjectIcon>;
  /** The bundle's skills and checklists, read once at startup; empty when the server can't read them. */
  bundledSkills?: BundledSkill[];
  /** This Mac's retention setting and what its last timed delete did. Absent in sample mode. */
  retention?: RetentionState;
  /** This Mac's choice for shaping threads after Start build, or why it can't be read. Absent in sample mode. */
  shapingThreadCleanup?: ShapingThreadCleanupState;
  /** This machine's heavy command limit and the number Automatic gives here. Absent in sample mode. */
  heavyCommandLimit?: HeavyCommandLimitState;
  /** This machine's build limit and the number Automatic gives here, the heavy command limit. Absent in sample mode. */
  buildLimit?: BuildLimitState;
  /** This machine's Auto-build switch and model. Absent in sample mode. */
  autoBuild?: AutoBuildState;
  /** What Auto-build's last pass found. Absent in sample mode. */
  autoBuildPass?: AutoBuildPass;
}

/** What the board does to an item's shaping threads once Start build records a build thread. */
export const SHAPING_THREAD_CLEANUPS = ['keep', 'settle', 'archive', 'delete'] as const;
export type ShapingThreadCleanup = typeof SHAPING_THREAD_CLEANUPS[number];
export type ShapingThreadCleanupState = { choice: ShapingThreadCleanup } | { problem: string };

/** How many heavy commands may run at once on this machine, across all builds and worktrees: Automatic, or a whole number from 1. */
export type HeavyCommandLimit = 'automatic' | number;
/** The saved limit, the number Automatic gives on this machine, and why a file that couldn't be read or held an invalid value counts as Automatic. */
export interface HeavyCommandLimitState { limit: HeavyCommandLimit; automatic: number; problem?: string }
/** How many builds may work at once on this machine: Automatic, which follows the heavy command limit, or a whole number from 1. */
export type BuildLimit = HeavyCommandLimit;
export type BuildLimitState = HeavyCommandLimitState;

/** This machine's Auto-build: whether the board starts eligible Ready builds by itself, and on which model; none leaves it to T3 ("T3 Project default"). */
export interface AutoBuild { on: boolean; model?: ModelChoice }
/** The saved Auto-build, and why a file that couldn't be read or held an invalid value counts as off. */
export type AutoBuildState = AutoBuild & { problem?: string };

/** What Auto-build's last pass found, for the Shaping header and the rows. */
export interface AutoBuildPass {
  /** Why the pass started nothing it otherwise would have. A hold marks nothing on a build and retries by itself. */
  hold?: string;
  /** How many builds a pass with the switch on would start now. */
  wouldStart: number;
  /** The builds whose automatic start failed, with its error, until a Start build on one succeeds or a new gate passes. */
  paused: Record<string, string>;
  /** The Ready builds Auto-build waits on until their concept's Refinement is complete. */
  waitsForRefinement: string[];
}

/** The number a limit allows: the saved number, or the one Automatic gives. */
export const limitNumber = ({ limit, automatic }: HeavyCommandLimitState): number => (limit === 'automatic' ? automatic : limit);

/** When finished and set-aside work leaves the board, and when, if ever, it is deleted. */
export interface RetentionState {
  /** Days after work is finished or set aside before the board hides it. */
  hideAfterDays: number;
  /** Days after work is finished or set aside before it is deleted, or null to keep it. */
  deleteAfterDays: number | null;
  /** Why the board can't read the setting, which then keeps everything. */
  problem?: string;
  /** What the last timed delete did: the work it deleted, and the due work it kept with the reason. */
  lastDelete?: { at: string; deleted: string[]; kept: { workId: string; reason: string }[] };
}

/** The repository's icon, whatever the case; undefined when it has none. */
export function repositoryProjectIcon(data: Pick<BoardData, 'projectIcons'>, repo: string): ProjectIcon | undefined {
  return Object.entries(data.projectIcons ?? {}).find(([r]) => sameRepo(r, repo))?.[1];
}

/** The hint for adding the repository's T3 project when a start can't find it, whatever the case; null when it can, or before the first read. */
export function repositoryProjectHint(data: Pick<BoardData, 'repositoryProjects'>, repo: string | null): string | null {
  const key = repo?.toLowerCase();
  return Object.entries(data.repositoryProjects ?? {}).find(([r]) => r.toLowerCase() === key)?.[1] ?? null;
}

/** Why Start build and Start refining are held for a repository still onboarding. */
export const WAITS_FOR_ONBOARDING = "Waits for onboarding to finish";

/** Whether the repository is on this Mac's list still onboarding, whatever the case. */
export function isOnboarding(data: Pick<BoardData, 'onboarding'>, repo: string | null): boolean {
  return repo !== null && Boolean(data.onboarding?.some((o) => sameRepo(o.repo, repo)));
}

/**
 * Why a start in the repository is held, whatever the case: its onboarding's PR hasn't merged, or T3 has no project
 * for it; null when nothing holds it.
 */
export function startHold(data: Pick<BoardData, 'onboarding' | 'repositoryProjects'>, repo: string | null): string | null {
  if (isOnboarding(data, repo)) return WAITS_FOR_ONBOARDING;
  return repositoryProjectHint(data, repo);
}

/** The commands the board checks; az only while a listed repository is on Azure DevOps. */
export type CheckedTool = 'gh' | 't3' | 'git' | 'jq' | 'curl' | 'az';

/** A check that passed: the command runs, with the version it printed if it did. */
type Passed = { result: 'ok'; version?: string };
/** A missing command, naming the override that pointed nowhere if one did. */
type Missing = { result: 'missing'; override?: string };

/** gh runs, is missing or logged out, or needs an upgrade for lar-shape’s commands. */
export type GhCheck =
  | Passed
  | Missing & { fix: string }
  | { result: 'logged-out'; version?: string; fix: string }
  | { result: 'outdated'; version: string; fix: string };


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

/** The oldest gh lar-shape's scripts run with: 2.94.0 added `--parent`, `--add-sub-issue` and `--blocked-by`. */
export const GH_FLOOR = '2.94.0';

/**
 * Every check from one lookup, each as it lands; a check is absent before its first result, `gh` too when no listed
 * repository is on GitHub, and `az` when none is on Azure DevOps, as then it isn't checked. `fix` is the command that
 * fixes a failed check.
 */
export interface ToolChecks { gh?: GhCheck; t3?: T3Check; git?: CommandCheck; jq?: CommandCheck; curl?: CommandCheck; az?: AzCheck }

/** A provider's tool, which the board checks only while a listed repository needs it. */
export type ProviderTool = 'gh' | 'az';

/** Which commands the running check still checks, and which providers' tools it leaves out. */
export interface ToolProgress { checking: CheckedTool[]; skipped: ProviderTool[] }

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

/** Where a repository's items come from: its issues or an Azure team's combined board. */
export type ItemSource = ItemSourceKind;

/** Where a repository's items come from, defaulting to GitHub issues. */
export function itemSource(repo: RepoConfig): ItemSource {
  return repo.items ?? 'issues';
}

/** The provider's tool a source reads with: az for an Azure DevOps board, gh for GitHub issues. */
export function providerTool(source: ItemSource): ProviderTool {
  return source === 'azure-board' ? 'az' : 'gh';
}

/** Whether any of the repositories is on GitHub, so the board reads it with gh. */
export function usesGh(repos: readonly { repo: string }[]): boolean {
  return repos.some((r) => !onAzure(r.repo));
}

/**
 * Whether gh's check stops the board reading a repository whose items come from `source`: for a GitHub source, before
 * gh's check, or while gh is missing or logged out. gh never
 * stops an Azure DevOps read.
 */
export function ghBlocksRead(check: GhCheck | undefined, source: ItemSource): boolean {
  if (providerTool(source) === 'az') return false;
  if (!check || check.result === 'missing' || check.result === 'logged-out') return true;
  return false;
}

// ---------- kinds ----------

export type Kind =
  | 'bug'
  | 'feature'
  | 'improvement'
  | 'concept'
  | 'decision'
  | 'build'
  | 'issue';

export function decisionType(item: Item): string | null {
  if (item.decisionMethod !== undefined) return item.decisionMethod;
  const label = item.labels.find((l) => l.startsWith('decision-'));
  return label ? label.slice('decision-'.length) : null;
}

/** A decision records its method on the first line, independently of tracker labels. */
export function parseDecisionMethod(body: string): Item['decisionMethod'] {
  const method = /^Method:\s*(grill|prototype|research|task)\s*$/i.exec(body.split('\n')[0]?.trim() ?? '')?.[1]?.toLowerCase();
  return method as Item['decisionMethod'] ?? null;
}

/** How the board names a decision's method: Grill, Prototype, Research or Task, or No method for anything else. */
export function methodName(method: string | null): string {
  return method && ['grill', 'prototype', 'research', 'task'].includes(method) ? `${method.charAt(0).toUpperCase()}${method.slice(1)}` : 'No method';
}

/** A decision's method as `methodName` gives it; null for any other kind of item. */
export const decisionMethodName = (item: Item): string | null => (item.kind === 'decision' ? methodName(decisionType(item)) : null);

/** The kind a ticket's labels give it. */
export function labelKind(labels: readonly string[]): Kind {
  const has = (l: string) => labels.includes(l);
  if (has('concept')) return 'concept';
  if (labels.some((l) => l.startsWith('decision-'))) return 'decision';
  if (has('bug')) return 'bug';
  if (has('feature')) return 'feature';
  if (has('improvement')) return 'improvement';
  if (has('build')) return 'build';
  return 'issue';
}

/** An issue that becomes one PR, delivered through its slices: the `build` label decides it, whatever the kind,
 *  except on a concept, whose sub-issues are items on the board. */
export function isBuild(item: Pick<Item, 'labels'>): boolean {
  return item.labels.includes('build') && !item.labels.includes('concept');
}

export function kindLabel(item: Item): string {
  const { kind } = item;
  const type = decisionType(item);
  return kind === 'decision' && type ? `decision-${type}` : kind;
}

// ---------- checks ----------

/** Running while any check runs, then failed if any failed, else passed. */
export function checkState(checks: Checks | null): CheckState | null {
  if (!checks) return null;
  if (checks.running) return 'running';
  return checks.failed ? 'failed' : 'passed';
}

/** The linked pull request Open PR opens, with its checks and merge state. */
interface ItemPr {
  url: string;
  /** Null when nothing read the PR's checks and merge state. */
  pipeline: Pipeline | null;
}

/** The item's first linked PR; null when it links none. */
export function itemPr(item: Pick<Item, 'linkedPrs'>): ItemPr | null {
  const pr = item.linkedPrs[0];
  return pr ? { url: pr.url, pipeline: pr.pipelineUnread ? null : pr } : null;
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

/** The key an item's repository has on the board. */
export const repoKey = (item: Pick<Item, 'repo'>): string => item.repo;

/** Whether two `owner/name`s, or repository keys, are the same repository: GitHub ignores case, so the board does too. */
export const sameRepo = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Whether the first read hasn't landed the repository's items yet, as its source still reads or waits for its tool's check. */
export const stillReading = (data: Pick<BoardData, 'firstRead'>, repo: string): boolean =>
  data.firstRead.waiting?.some((waiting) => sameRepo(waiting, repo)) === true;

/**
 * Whether the first read may still add items to a scope: the whole board until it settles, or one repository until its
 * items land, which, before any repository's have, is every repository.
 */
export const readingScope = (data: Pick<BoardData, 'firstRead'>, repo?: string): boolean =>
  !data.firstRead.settled && (!repo || !data.firstRead.waiting || stillReading(data, repo));

/** Whether the item shows in the repository's List and Scope: it's the item's repository, or one of its untagged repositories. */
export const inRepo = (item: Pick<Item, 'repo' | 'untaggedFor'>, repo: string): boolean =>
  sameRepo(repoKey(item), repo) || Boolean(item.untaggedFor?.some((r) => sameRepo(r, repo)));

/** The name of the item's repository as the board shows it. */
export const itemRepoNames = (item: Pick<Item, 'repo'>, repos: readonly RepoConfig[]): string => repoName(repoKey(item), repos);

/** Whether a repository is on Azure DevOps: organization/project/repository, not GitHub's owner/name. */
export const onAzure = (repo: string): boolean => repo.split('/').length === 3;

/** A part of a repository's key as people read it: an Azure DevOps origin's `Fabrikam%20Fiber` is `Fabrikam Fiber`. */
export const decodePart = (part: string): string => {
  try { return decodeURIComponent(part); } catch { return part; }
};

/**
 * A repository's key as the board shows it, each part decoded: `contoso/Fabrikam%20Fiber/lar-api` shows as
 * `contoso/Fabrikam Fiber/lar-api`. The key itself stays encoded, for matching and URLs.
 */
export const shownRepo = (repo: string): string => repo.split('/').map(decodePart).join('/');

const REPO_TAG_PREFIX = 'repo-';
/** The tag that records an Azure work item's repository: repo- and the repository's name as Azure shows it. */
export const repoTag = (repo: string): string => `${REPO_TAG_PREFIX}${decodePart(repo.split('/').at(-1)!)}`;
/** Whether the tag records a work item's repository; Azure keeps a tag's case, so the board ignores it. */
export const isRepoTag = (tag: string): boolean => tag.trim().toLowerCase().startsWith(REPO_TAG_PREFIX);

/**
 * A repository's shown name: the part after the last `/` of `owner/name` or `organization/project/repository`, or all
 * of it when another of `repos` has the same name; decoded, as `shownRepo` shows it.
 */
export function repoName(key: string, repos: readonly RepoConfig[]): string {
  if (!key.includes('/')) return key;
  const nameOf = (repo: string) => repo.split('/').at(-1);
  const name = nameOf(key)!;
  return shownRepo(repos.some((r) => !sameRepo(r.repo, key) && nameOf(r.repo) === name) ? key : name);
}

/** The item's shortest name: its ticket's number, `#12`, or its title while it has no ticket. */
export function ref(item: Pick<Item, 'number' | 'title'>): string {
  return item.number ? `#${item.number}` : item.title;
}

/** The item's name in a sentence: `#12 Title`, or the title alone while it has no ticket. */
export function itemName(item: Pick<Item, 'number' | 'title'>): string {
  return item.number ? `#${item.number} ${item.title}` : item.title;
}

/** Abandon closes a List or Queued issue. */
export function canAbandon(item: Item): boolean {
  return item.status === 'List' || item.status === 'Queued';
}

export interface FactoryThreadContext {
  dataDir: string;
  bin: string;
  shapeSkill: string;
  azureReadOnly?: boolean;
}
const shellPath = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function factoryEnvironment(context: FactoryThreadContext): string {
  return [
    'Use the factory installation and data folder below for this thread and every subagent.',
    'Before running any factory command, set this environment in that command shell:',
    `export LAR_FACTORY_DATA_DIR=${shellPath(context.dataDir)}`,
    `export PATH=${shellPath(context.bin)}:"$PATH"`,
    ...(context.azureReadOnly ? ["export LAR_FACTORY_AZURE_READ_ONLY='1'", 'All Azure DevOps organizations are read-only. Never launch Azure implementation or write through another tool.'] : []),
    `Use ${shellPath(`${context.bin}/lar-work`)} for work records. Never use another data folder or command installation.`,
    'Pass these exact paths and environment to every delegated task. The target repository needs no factory files or factory instructions in AGENTS.md or CLAUDE.md.',
  ].join('\n');
}
function shapeInstructions(item: Item, context?: FactoryThreadContext | null): string {
  if (!context) return `$lar-shape ${item.id}`;
  return `Shape ${item.id}. Read ${shellPath(context.shapeSkill)} and follow it.\nShaping is independent of implementation. Do not build unless the user later chooses Start build.\n\n${factoryEnvironment(context)}`;
}

/** The work message. Line 1, which T3 titles the thread from, is `Shaping` and the item's name in a sentence; then come its instructions, with its work ID. */
export function workMessage(item: Item, context?: FactoryThreadContext | null): string {
  return `Shaping ${itemName(item)}\n${shapeInstructions(item, context)}`;
}

/** The work message boards sent before thread names carried a phase, which a launch intent still unresolved may have started. */
export function earlierWorkMessage(item: Item, context?: FactoryThreadContext | null): string {
  return `${itemName(item)}\n${shapeInstructions(item, context)}`;
}

/**
 * The branch Start build's worktree takes: `<kind>/<n>-<slug>`, or `<kind>/<first 8 characters of the work ID>-<slug>`
 * for ticketless work, the kind `fix` for a bug,
 * `feat` for a feature or improvement, else `chore`. The slug is up to five words of the
 * title, lowercase and hyphen-joined, accents dropped and anything but a-z and 0-9 left out.
 */
export function buildBranch(item: Item): string {
  const { kind } = item;
  const prefix = kind === 'bug' ? 'fix' : kind === 'feature' || kind === 'improvement' ? 'feat' : 'chore';
  const words = item.title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean).slice(0, 5);
  return `${prefix}/${[item.number || item.id.slice(0, 8), ...words].join('-')}`;
}

/** The build message boards sent before thread names carried a phase, which a launch intent still unresolved may have started. */
export function earlierBuildMessage(item: Item, larBuild: string, context?: FactoryThreadContext | null): string {
  const message = `Build ${item.id}. Read ${larBuild}/agents/builder.md and follow it.`;
  return context ? `${message}\n\n${factoryEnvironment(context)}` : message;
}

/** Start build's message. Line 1, which T3 titles the thread from, is `Build` and the item's name in a sentence; then come the build's work ID and the builder agent of the lar-build installed at `larBuild`. */
export function buildMessage(item: Item, larBuild: string, context?: FactoryThreadContext | null): string {
  return `Build ${itemName(item)}\n${earlierBuildMessage(item, larBuild, context)}`;
}

/** Whether the data is stale: the latest read failed, or none succeeded for 3 intervals. A first read still running isn't. */
export function isStale(data: BoardData, now: number): boolean {
  if (data.error) return true;
  if (!data.fetchedAt) return false;
  return now - Date.parse(data.fetchedAt) > data.refreshSeconds * 3 * 1000;
}

/** The service that hosts a repository, from its origin's host. */
export const PROVIDERS = ['GitHub', 'Azure DevOps'] as const;

export type Provider = (typeof PROVIDERS)[number];

/**
 * Where a repository's items come from: its own GitHub issues, or an Azure DevOps team's
 * backlog and current sprint together in the repository's project.
 */
export type RepositoryItemSource = { kind: 'issues' } | { kind: 'azure-board'; team: string };

/** Where a repository's glossary and ADRs go: its own files at these paths, or disabled. */
export type DomainDocLocation = { kind: 'off' } | { kind: 'repository'; glossary: string; adrs: string };

/**
 * Settings saved on this machine. Credentials stay with the provider's CLI.
 */
export interface SharedRepositorySettings {
  /** Repository role: what this repository is to the others. */
  role?: string;
  itemSource?: RepositoryItemSource;
  labels?: string[];
  domainDocs?: DomainDocLocation;
  /** The project skills the user selected as coding guidance for builds. */
  skills?: string[];
  vocabulary?: VocabularyMapping;
  createIssuesFromAddItem?: boolean;
  createIssuesFromRetro?: boolean;
  writeRefinedSpec?: boolean;
}

/** Settings editable on this machine. */
export const SHARED_SETTINGS = ['role', 'itemSource', 'labels', 'domainDocs', 'skills', 'vocabulary', 'createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec'] as const satisfies readonly (keyof SharedRepositorySettings)[];

export type SharedSetting = (typeof SHARED_SETTINGS)[number];

/** Whether a value was set on this machine or uses the factory default. */
export type SettingSource = 'local' | 'default';

/** The repository writes the factory may need, each with its own verified credential access. */
export const REPOSITORY_OPERATIONS = ['push-branch', 'open-pr', 'publish-ticket', 'edit-ticket', 'tag-ticket', 'manage-labels', 'comment-ticket', 'type-ticket', 'relate-ticket'] as const;

export type RepositoryOperation = (typeof REPOSITORY_OPERATIONS)[number];

/** GitHub discovers immutable structure comments through a label; Azure uses revision-checked descriptions. */
export function structureSyncOperations(repo: string): readonly RepositoryOperation[] {
  return onAzure(repo) ? ['publish-ticket', 'edit-ticket', 'comment-ticket'] : ['publish-ticket', 'comment-ticket', 'tag-ticket'];
}

/** What the user's credentials allow for an operation, as last found; one not needed since the last check stays unverified. */
export type OperationAccess = 'unverified' | 'allowed' | 'refused';

/** Delivery needs both permissions; reading and shaping remain independent. */
export function buildAccessProblem(access: Partial<Record<'push-branch' | 'open-pr', OperationAccess>> = {}): string | null {
  const missing = ([['push-branch', 'push branches'], ['open-pr', 'open pull requests']] as const)
    .filter(([operation]) => access[operation] !== 'allowed').map(([, name]) => name);
  return missing.length ? `Builds need verified access to ${missing.join(' and ')}. Recheck repository access in Settings.` : null;
}

/**
 * One repository's local settings, with factory defaults for values the user has not set.
 */
export interface RepositorySetup {
  repo: string;
  /** The server session's Azure write restriction, never a saved preference. */
  azureReadOnly?: boolean;
  /** Save concepts and relationships on the tracker for recovery on another machine. */
  structureSync: boolean;
  createIssuesFromAddItem?: boolean;
  createIssuesFromRetro?: boolean;
  writeRefinedSpec?: boolean;
  /** The T3 project its threads start in, once onboarding picked one. */
  projectId?: string;
  role: string;
  /** Null for an Azure DevOps repository whose team no setting names yet. */
  itemSource: RepositoryItemSource | null;
  labels: string[];
  domainDocs: DomainDocLocation;
  skills: string[];
  vocabulary: EffectiveVocabulary;
  vocabularySources: VocabularySources;
  access: Record<RepositoryOperation, OperationAccess>;
  /** Where each setting's value comes from. */
  sources: Record<SharedSetting, SettingSource>;
  /** The other repositories the user connected it to, on this Mac only; the board's reads always fill it. */
  connections?: string[];
}

/** Repository values used by item sources. */
export interface RepositoryConfigAnswers extends SharedRepositorySettings {
  itemSource: RepositoryItemSource;
  role: string;
  /** Its custom labels: the file's `labels`, or those the Labels step picked. */
  labels: string[];
}

/**
 * What the setup step has answered so far, as typed. Only Azure DevOps asks for a team.
 */
export interface SetupAnswers {
  itemSource: RepositoryItemSource['kind'];
  /** The Azure DevOps team whose backlog and current sprint the board reads. */
  team?: string;
  role: string;
}

/** What an onboarding has answered so far. Later steps add theirs. */
export interface OnboardingAnswers {
  /** The picked T3 project's id. */
  projectId: string;
  /** The picked T3 project's provider, from its origin's host; absent while the dialog hasn't read it. */
  provider?: Provider;
  /** The Provider and item source step's answers, once it has shown. */
  setup?: SetupAnswers;
  /** The wizard's answers the user changed from their detected defaults. */
  choices?: OnboardingChoices;
}

/** The onboarding wizard's answers, each one absent while its detected default stands. */
export interface OnboardingChoices {
  newLabels?: LocalSetupAnswers['newLabels'];
  createIssuesFromAddItem?: boolean;
  createIssuesFromRetro?: boolean;
  writeRefinedSpec?: boolean;
  vocabulary?: VocabularyMapping;
  structureSync?: boolean;
  itemSource?: RepositoryItemSource;
  role?: string;
  domainDocs?: DomainDocLocation;
  skills?: string[];
  /** The other onboarded repositories ticked in the Connections step. */
  connections?: string[];
}

/** Where an onboarding stopped when its dialog closed, so Resume reopens it there. */
export interface OnboardingProgress {
  /** The step it was on, by id. */
  step: string;
  /** The steps it has passed, by id. */
  done: string[];
  answers: OnboardingAnswers;
}

/** A repository on this Mac's list that is still onboarding, with where it stopped. */
export interface OnboardingRepository {
  repo: string;
  progress: OnboardingProgress;
}

/** A T3 project onboarding can offer, with what the T3 project step shows about its repository. */
export interface ProjectChoice {
  id: string;
  /** The T3 project's title. */
  name: string;
  folder: string;
  /** `folder` as the step shows it, with the home folder as `~`, which the browser can't work out. */
  shownFolder: string;
  /** `owner/name` from the folder's origin; null when the folder isn't a main checkout with an origin on a provider. */
  repo: string | null;
  provider: Provider | null;
  /** Why `repo` is null; null when it isn't. */
  blocked: 'linked-worktree' | 'no-provider-origin' | null;
  /** Whether the repository is already on the board or is onboarding. Unusable settings can start fresh. */
  onBoard: boolean;
  /** The project's icon from T3; null when it has none or T3 hasn't given one yet. */
  icon: ProjectIcon | null;
}

/**
 * The checks onboarding's Checks step runs after the command checks: that the T3 project's folder is the main checkout
 * of the repository's origin, that the item source can be read, and that gh's login can push to the repository.
 */
export const SETUP_CHECKS = ['checkout', 'source', 'push'] as const;
export type SetupCheckId = (typeof SETUP_CHECKS)[number];

/** A setup check's result: what it found, or the problem with its fix and the command that fixes it, when one does. */
export type SetupCheckResult = { passed: true; detail: string } | { passed: false; problem: string; fix: string; command?: string };

/** A fact onboarding's detection found, or why the login's access kept it from finding it. */
export type Detected<T> = { found: T } | { refused: string };

/**
 * What onboarding detects about a repository before it asks anything, reading only: each fact found, or Refused with
 * why. `access` is what the login's permissions show for each operation; one they can't settle stays unverified.
 */
export interface SetupDetection {
  repo: string;
  azureReadOnly?: boolean;
  provider: Provider;
  /** The T3 project's folder, once it is the repository's only main checkout. */
  checkout: Detected<string>;
  /** The item sources the board can read: the repository's issues, or one per Azure DevOps team. */
  itemSources: Detected<RepositoryItemSource[]>;
  access: Record<RepositoryOperation, OperationAccess>;
  /** The repository's own glossary and ADRs when it has either, else off. */
  domainDocs: Detected<DomainDocLocation>;
  /** The names of the repository's project skills, which the user may select as coding guidance. */
  projectSkills: Detected<string[]>;
}

/** Onboarding's answers, which become the repository's local settings. */
export interface LocalSetupAnswers {
  createIssuesFromAddItem?: boolean;
  createIssuesFromRetro?: boolean;
  writeRefinedSpec?: boolean;
  newLabels?: Partial<Record<import('./vocabulary.ts').VocabularyKey, string[]>>;
  vocabulary?: VocabularyMapping;
  structureSync?: boolean;
  projectId: string;
  role: string;
  itemSource: RepositoryItemSource;
  domainDocs: DomainDocLocation;
  skills: string[];
}


export function openQuestionThread(item: Item) {
  return Array.isArray(item.threads) ? item.threads.find((thread) => thread.state === 'needs you' && !thread.observedAt) : undefined;
}

/** The item's build thread as T3 shows it now, not a cached copy. */
export function currentBuildThread(item: Item) {
  return Array.isArray(item.threads) ? item.threads.find((thread) => thread.purpose === 'build' && !thread.observedAt) : undefined;
}

/** Whether the board can't trust what it knows of thread activity: the page's read failed, the data is stale or the first read hasn't settled. */
export function activityUnavailable(data: BoardData, now: number, clientError?: string | null): boolean {
  return !!clientError || isStale(data, now) || !data.firstRead.settled;
}

/**
 * Whether an item at Verify or Ready to merge is at work again: its current build thread, a child of it or a slice runs, and
 * nothing holds it for the user. It then counts as in flight, with its recorded Status unchanged.
 */
export function workingAgain(item: Item, unavailable = false): boolean {
  if (item.status !== 'Verify' && item.status !== 'Ready to merge') return false;
  if (unavailable || item.paused || item.archived || item.needsYou || openQuestionThread(item)) return false;
  const current = currentBuildThread(item);
  return !!current?.currentRunning || delegatedWorkRunning(item);
}

/**
 * The builds that count against the build limit, in every repository: a build whose start is in flight or may have
 * started, one In progress or Review, and one at Verify or Ready to merge at work again. A concept never counts.
 */
export function buildsAtWork(data: Pick<BoardData, 'items' | 'startProgress'>, unavailable = false): Item[] {
  return data.items.filter((item) => {
    if (item.kind === 'concept') return false;
    const start = startProgressOf(data, item.id, 'build');
    return start?.phase === 'starting' || start?.phase === 'may-have-started' ||
      item.status === 'In progress' || item.status === 'Review' || workingAgain(item, unavailable);
  });
}

export function buildActivity(item: Item, stale = false, start?: StartProgress): { label: string; running: boolean } {
  if (start?.phase === 'starting') return { label: 'Starting', running: false };
  if (start?.phase === 'may-have-started') return { label: 'May have started', running: false };
  if (workingAgain(item, stale)) return { label: 'Working', running: true };
  if (!['In progress', 'Review', 'Ready'].includes(item.status)) return { label: item.status, running: false };
  const current = currentBuildThread(item);
  if (stale || item.paused || item.archived || item.needsYou) return { label: 'Activity unavailable', running: false };
  const running = !!current?.currentRunning || delegatedWorkRunning(item);
  if (!current && !running) return { label: 'Activity unavailable', running: false };
  if (!running) return { label: current?.state === 'stopped' ? 'Stopped' : current?.state === 'needs you' ? 'Needs you' : 'Activity unavailable', running: false };
  // A builder can still be integrating or checking after its last slice finishes, before it records the next phase.
  if (item.buildPhase === 'implement' && item.slices?.length > 0 && item.slices.every((slice) => slice.progress === 'done')) {
    return { label: 'Finishing build', running };
  }
  const phases: Record<string, string> = { plan: 'Planning', implement: 'Implementing', review: 'Review', checks: 'Checks', 'full-checks': 'Checks', 'domain-docs': 'Updating docs', approve: 'Awaiting approval', retro: 'Retro' };
  return { label: phases[item.buildPhase ?? ''] ?? 'Working', running };
}
