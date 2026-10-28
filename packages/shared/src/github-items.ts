// Repository issues as GitHub's GraphQL API returns them, and the rules that turn them into the
// board's items. The server reads them through gh; the page's tests build boards from them.

import { isBuild, labelStatuses, sliceProgress } from './model.ts';
import type { Checks, ConceptMap, IssueRef, Item, LinkedPr, MergeState, Slice, Status } from './model.ts';
import { parseConceptMap } from './concept-map.ts';

interface RawLabelConn {
  nodes: { name: string }[];
}

export interface RawIssueRef {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  /** Read for sub-issues only. */
  stateReason?: string | null;
  repository: { nameWithOwner: string };
}

/** An issue blocking an item, as the blocked-by link reads it. */
interface RawBlocker {
  number: number;
  state: 'OPEN' | 'CLOSED';
  repository: { nameWithOwner: string };
}

/** What the issue searches found, as `repo#number` keys: open issues labelled `active` or `blocked`, and issues labelled `build`. */
export interface Searched {
  active?: ReadonlySet<string>;
  blocked?: ReadonlySet<string>;
  builds?: ReadonlySet<string>;
}

interface RawContent {
  __typename: 'Issue';
  /** The issue's node id: the board's Item.id, and what a dossier's body is read by. */
  id: string;
  /** Read for concepts only, in a query of its own. */
  body?: string;
  title: string;
  updatedAt: string;
  number: number;
  url: string;
  /** OPEN or CLOSED. */
  state?: string;
  /** An issue's close reason, such as COMPLETED or NOT_PLANNED. */
  stateReason?: string | null;
  closedAt?: string | null;
  repository: { nameWithOwner: string };
  labels?: RawLabelConn;
  parent?: RawIssueRef | null;
  subIssuesSummary?: { total: number; completed: number };
  subIssues?: { nodes: RawIssueRef[] };
  blockedBy?: { nodes: RawBlocker[] };
  closedByPullRequestsReferences?: { nodes: RawLinkedPr[] };
}

interface RawStateCount {
  state: string;
  count: number;
}

export interface RawLinkedPr {
  /** The PR's node id, which its body and merge time are read by. */
  id?: string;
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  /** Read for builds' linked PRs only, in a query of their own. */
  body?: string;
  /** Read for builds' linked PRs only, with the body. */
  mergedAt?: string | null;
  mergeStateStatus?: string;
  statusCheckRollup?: {
    contexts: {
      checkRunCountsByState: RawStateCount[];
      statusContextCountsByState: RawStateCount[];
      nodes: {
        status?: string;
        startedAt?: string | null;
        checkSuite?: { createdAt: string };
        state?: string;
        createdAt?: string;
      }[];
    };
  } | null;
}

export interface RawItem {
  /** The raw issue id. */
  id: string;
  updatedAt: string;
  content: RawContent | null;
}

// ---------- normalizing ----------

type CheckOutcome = 'passed' | 'failed' | 'running';

// Check run states (CheckStatusState and CheckConclusionState) and commit status states.
const CHECK_RUN_OUTCOMES: Record<string, CheckOutcome> = {
  SUCCESS: 'passed', NEUTRAL: 'passed', SKIPPED: 'passed', COMPLETED: 'passed',
  FAILURE: 'failed', CANCELLED: 'failed', TIMED_OUT: 'failed', ACTION_REQUIRED: 'failed',
  STARTUP_FAILURE: 'failed', STALE: 'failed',
  IN_PROGRESS: 'running', QUEUED: 'running', PENDING: 'running', WAITING: 'running', REQUESTED: 'running',
};
const STATUS_CONTEXT_OUTCOMES: Record<string, CheckOutcome> = {
  SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'running', EXPECTED: 'running',
};

/** Counts a PR's checks by outcome; null when it has none. */
export function normalizeChecks(rollup: RawLinkedPr['statusCheckRollup']): Checks | null {
  if (!rollup) return null;
  const checks: Checks = { passed: 0, failed: 0, running: 0, total: 0, since: null };
  const tally = (counts: RawStateCount[], outcomes: Record<string, CheckOutcome>) => {
    for (const { state, count } of counts) {
      const outcome = outcomes[state];
      if (!outcome) continue;
      checks[outcome] += count;
      checks.total += count;
    }
  };
  tally(rollup.contexts.checkRunCountsByState, CHECK_RUN_OUTCOMES);
  tally(rollup.contexts.statusContextCountsByState, STATUS_CONTEXT_OUTCOMES);
  if (!checks.total) return null;
  // A rerun on the same head keeps its finished checks, so time only the running ones.
  // A queued check has no start yet; its suite's creation still times a stuck runner.
  checks.since = rollup.contexts.nodes
    .filter((n) => (n.status && CHECK_RUN_OUTCOMES[n.status] === 'running') || (n.state && STATUS_CONTEXT_OUTCOMES[n.state] === 'running'))
    .map((n) => n.startedAt ?? n.checkSuite?.createdAt ?? n.createdAt)
    .filter((at) => !!at)
    .sort()[0] ?? null;
  return checks;
}

const MERGE_STATES: Record<string, MergeState> = {
  CLEAN: 'can merge', HAS_HOOKS: 'can merge', UNSTABLE: 'can merge', UNKNOWN: 'checking',
  DIRTY: 'conflicts', BLOCKED: 'blocked', BEHIND: 'blocked', DRAFT: 'blocked',
};

/** GitHub's MergeStateStatus in four; checking while GitHub hasn't worked it out, or it wasn't read. */
export function normalizeMergeState(status: string | undefined): MergeState {
  // Own keys only, so a status such as constructor can't read the prototype.
  return (status && Object.hasOwn(MERGE_STATES, status) ? MERGE_STATES[status] : undefined) ?? 'checking';
}

function normalizeLinkedPr({ id: _id, statusCheckRollup, mergeStateStatus, state, ...pr }: RawLinkedPr): LinkedPr {
  const prState = state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open';
  return { ...pr, state: prState, checks: normalizeChecks(statusCheckRollup), mergeState: normalizeMergeState(mergeStateStatus) };
}

/** Open, or closed as done or not planned: an issue closed as completed (or before GitHub kept a reason) is done. */
function closing(c: RawContent): Pick<Item, 'state' | 'closedAs'> {
  if (c.state !== 'CLOSED') return { state: 'open', closedAs: null };
  const notPlanned = c.stateReason === 'NOT_PLANNED' || c.stateReason === 'DUPLICATE';
  return { state: 'closed', closedAs: notPlanned ? 'not-planned' : 'done' };
}

/** GitHub's issue state, as the board's provider-neutral one. */
const issueState = (state: 'OPEN' | 'CLOSED'): 'open' | 'closed' => (state === 'CLOSED' ? 'closed' : 'open');

function normalizeIssueRef(raw: RawIssueRef): IssueRef {
  return { number: raw.number, title: raw.title, url: raw.url, repo: raw.repository.nameWithOwner, state: issueState(raw.state) };
}

const rawLabels = (raw: RawItem): string[] => raw.content?.labels?.nodes.map((l) => l.name) ?? [];

/** An issue labelled `concept`, whose body holds its map. */
export const isRawConcept = (raw: RawItem) => rawLabels(raw).includes('concept');

export const refKey = (repo: string | null, number: number | null) => `${repo}#${number}`;

/** A build's sub-issues, including those closed as not planned; none for other items. A concept's sub-issues are items on the board. */
const rawSubIssues = (raw: RawItem): RawIssueRef[] => (isBuild({ labels: rawLabels(raw) }) ? raw.content?.subIssues?.nodes ?? [] : []);

/** A build's sub-issue labelled `build` is a build of its own, a board item, never a slice. */
const isBuildRef = (ref: RawIssueRef, builds: ReadonlySet<string>) => builds.has(refKey(ref.repository.nameWithOwner, ref.number));

/** A build's sub-issues that aren't builds. */
function rawSlices(raw: RawItem, builds: ReadonlySet<string>): RawIssueRef[] {
  return rawSubIssues(raw).filter((s) => !isBuildRef(s, builds));
}

/** GitHub's sub-issue counts, except that a build counts only its `build` sub-issues: its slices show in its slice bar. */
function subIssueCounts(raw: RawItem, builds: ReadonlySet<string>): Item['subIssues'] {
  if (!isBuild({ labels: rawLabels(raw) })) return raw.content?.subIssuesSummary ?? { total: 0, completed: 0 };
  const found = rawSubIssues(raw).filter((s) => isBuildRef(s, builds));
  return { total: found.length, completed: found.filter((b) => b.state === 'CLOSED').length };
}

/** Keeps GitHub's sub-issue order and hides slices closed as not planned. `active` and `blocked` hold the `repo#number` keys of open issues with that label. */
function normalizeSlices(raws: RawIssueRef[], active: ReadonlySet<string>, blocked: ReadonlySet<string>): Slice[] {
  return raws.flatMap((raw) => {
    const key = refKey(raw.repository.nameWithOwner, raw.number);
    const progress = sliceProgress(raw.state, raw.stateReason ?? null, { active: active.has(key), blocked: blocked.has(key) });
    return progress ? [{ ...normalizeIssueRef(raw), progress }] : [];
  });
}

/** Turns one raw item into the board's Item, reading its statuses `from` its item source's store; null for items we can't see. */
export function normalizeItem(raw: RawItem, { active = new Set(), blocked = new Set(), builds = new Set() }: Searched = {}): Item | null {
  const c = raw.content;
  if (!c) return null;
  const updated = [raw.updatedAt, c.updatedAt].filter(Boolean).sort().at(-1) ?? raw.updatedAt;
  const closed = closing(c);
  const statuses = labelStatuses(rawLabels(raw));
  const item: Item = {
    id: c.id,
    status: closed.closedAs === 'done' ? 'Done' : statuses[0] ?? 'List',
    statuses,
    content: 'ticket',
    number: c.number,
    title: c.title,
    url: c.url,
    repo: c.repository.nameWithOwner,
    labels: rawLabels(raw),
    ...closed,
    parent: c.parent ? normalizeIssueRef(c.parent) : null,
    subIssues: subIssueCounts(raw, builds),
    blockers: c.blockedBy?.nodes.map((b) => ({ number: b.number, repo: b.repository.nameWithOwner, state: issueState(b.state) })) ?? [],
    updatedAt: updated,
    closedAt: c.closedAt ?? null,
    linkedPrs: c.closedByPullRequestsReferences?.nodes.map(normalizeLinkedPr) ?? [],
    slices: normalizeSlices(rawSlices(raw, builds), active, blocked),
  };
  if (isRawConcept(raw)) item.map = parseConceptMap(c.body ?? '');
  return item;
}

/**
 * Normalizes an item source's raw items into board items. A slice lives inside its
 * build's card, so it's dropped here even when the repository read lists it. Membership in some build's slices decides, since `parent` has no labels.
 * An item closed as not planned is abandoned, and dropped too.
 */
export function normalizeItems(raws: RawItem[], searched: Searched = {}): Item[] {
  const items: Item[] = [];
  const bodies = new Map<string, string | undefined>();
  const slices = new Set<string>();
  for (const raw of raws) {
    const item = normalizeItem(raw, searched);
    if (!item) continue;
    items.push(item);
    bodies.set(item.id, raw.content?.body);
    // A slice closed as not planned is hidden from its build, but it's still no board item.
    for (const s of rawSlices(raw, searched.builds ?? new Set())) slices.add(refKey(s.repository.nameWithOwner, s.number));
  }
  const board = items.filter((i) => i.closedAs !== 'not-planned' && !slices.has(refKey(i.repo, i.number)));
  // An item with sub-issues on the board is a dossier too, so its body's map sections show, when it has any.
  const parents = parentKeys(board);
  for (const item of board) {
    const map = item.map ? undefined : parentMap(bodies.get(item.id), parents.has(refKey(item.repo, item.number)));
    if (map) item.map = map;
  }
  return board;
}

/** The `repo#number` keys of the issues the items name as their parent. */
const parentKeys = (items: readonly Item[]) => new Set(items.flatMap((i) => (i.parent ? [refKey(i.parent.repo, i.parent.number)] : [])));

/** A parent's map, from its body, when the body has any of the map's sections. */
function parentMap(body: string | undefined, isParent: boolean): ConceptMap | undefined {
  if (!isParent || !body) return undefined;
  const map = parseConceptMap(body);
  return map.destination || map.decisions.length || map.fog.length || map.check ? map : undefined;
}

/** The issues the line shows as dossiers, whose bodies hold their maps: every concept, and every item with a sub-issue on the board. */
export function rawDossiers(raws: RawItem[], searched: Searched = {}): RawItem[] {
  const parents = parentKeys(normalizeItems(raws, searched));
  return raws.filter((raw) => isRawConcept(raw) || parents.has(rawKey(raw)));
}

const rawKey = (raw: RawItem) => refKey(raw.content?.repository?.nameWithOwner ?? null, raw.content?.number ?? null);

/** The read’s own issues labelled `build`, read from the issue query, so the search index's lag can't miss them. */
export const readBuilds = (raws: RawItem[]) => new Set(raws.filter((raw) => isBuild({ labels: rawLabels(raw) })).map(rawKey));

/** The builds' linked PRs, whose bodies hold a build's stats block: the only linked PRs whose body and merge time the board reads. */
export const rawBuildPrs = (raws: RawItem[]): RawLinkedPr[] =>
  raws.filter((raw) => isBuild({ labels: rawLabels(raw) })).flatMap((raw) => raw.content?.closedByPullRequestsReferences?.nodes ?? []);

/** The issue searches for `build` issues, one per repo holding a build's sub-issue that isn't in the read; none when none is off it. */
export function buildSubIssueSearches(raws: RawItem[]): string[] {
  const inRead = new Set(raws.map(rawKey));
  const repos = new Set(raws.flatMap((raw) => rawSubIssues(raw)
    .filter((s) => !inRead.has(refKey(s.repository.nameWithOwner, s.number)))
    .map((s) => s.repository.nameWithOwner)));
  return [...repos].map((repo) => `is:issue label:build repo:${repo}`);
}

/** The issue searches for open issues with a slice label, one per repo holding a build's open slice; none when none is open. */
export function sliceLabelSearches(label: 'active' | 'blocked', raws: RawItem[], builds: ReadonlySet<string> = new Set()): string[] {
  const repos = new Set(raws.flatMap((raw) =>
    rawSlices(raw, builds).filter((s) => s.state === 'OPEN').map((s) => s.repository.nameWithOwner)));
  return [...repos].map((repo) => `is:issue is:open label:${label} repo:${repo}`);
}

