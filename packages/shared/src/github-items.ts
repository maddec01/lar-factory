// Project items as GitHub's GraphQL API returns them, and the rules that turn them into the
// board's items. The server reads them through gh; the page's tests build boards from them.

import { STATUSES, isBuild, sliceProgress } from './model.ts';
import type { Checks, ContentType, IssueRef, Item, LinkedPr, Slice, Status } from './model.ts';

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

/** What the issue searches found, as `repo#number` keys: open issues labelled `active` or `blocked`, and issues labelled `build`. */
export interface Searched {
  active?: ReadonlySet<string>;
  blocked?: ReadonlySet<string>;
  builds?: ReadonlySet<string>;
}

interface RawContent {
  __typename: ContentType;
  title: string;
  updatedAt: string;
  number?: number;
  url?: string;
  state?: string;
  closedAt?: string | null;
  isDraft?: boolean;
  repository?: { nameWithOwner: string };
  labels?: RawLabelConn;
  parent?: RawIssueRef | null;
  subIssuesSummary?: { total: number; completed: number };
  subIssues?: { nodes: RawIssueRef[] };
  issueDependenciesSummary?: { blockedBy: number };
  closedByPullRequestsReferences?: { nodes: RawLinkedPr[] };
}

interface RawStateCount {
  state: string;
  count: number;
}

export interface RawLinkedPr {
  number: number;
  url: string;
  state: string;
  isDraft: boolean;
  body?: string;
  mergedAt?: string | null;
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
  id: string;
  updatedAt: string;
  status: { name?: string } | null;
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

function normalizeLinkedPr({ statusCheckRollup, ...pr }: RawLinkedPr): LinkedPr {
  return { ...pr, checks: normalizeChecks(statusCheckRollup) };
}

function toStatus(name: string | undefined): Status {
  return (STATUSES as readonly string[]).includes(name ?? '') ? (name as Status) : 'List';
}

function normalizeIssueRef(raw: RawIssueRef): IssueRef {
  return { number: raw.number, title: raw.title, url: raw.url, repo: raw.repository.nameWithOwner, state: raw.state };
}

const rawLabels = (raw: RawItem): string[] => raw.content?.labels?.nodes.map((l) => l.name) ?? [];

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

/** Turns one raw project item into the board's Item; null for items we can't see. */
export function normalizeItem(raw: RawItem, { active = new Set(), blocked = new Set(), builds = new Set() }: Searched = {}): Item | null {
  const c = raw.content;
  if (!c) return null;
  const updated = [raw.updatedAt, c.updatedAt].filter(Boolean).sort().at(-1) ?? raw.updatedAt;
  return {
    id: raw.id,
    status: toStatus(raw.status?.name),
    type: c.__typename,
    number: c.number ?? null,
    title: c.title,
    url: c.url ?? null,
    repo: c.repository?.nameWithOwner ?? null,
    labels: rawLabels(raw),
    state: c.state ?? null,
    parent: c.parent ? normalizeIssueRef(c.parent) : null,
    subIssues: subIssueCounts(raw, builds),
    blockedBy: c.issueDependenciesSummary?.blockedBy ?? 0,
    updatedAt: updated,
    closedAt: c.closedAt ?? null,
    linkedPrs: c.closedByPullRequestsReferences?.nodes.map(normalizeLinkedPr) ?? [],
    slices: normalizeSlices(rawSlices(raw, builds), active, blocked),
  };
}

/**
 * Normalizes a project's raw items into board items. A slice lives inside its
 * build's card, so it's dropped here even when the project's auto-add put it on
 * the project. Membership in some build's slices decides, since `parent` has no labels.
 */
export function normalizeItems(raws: RawItem[], searched: Searched = {}): Item[] {
  const items: Item[] = [];
  const slices = new Set<string>();
  for (const raw of raws) {
    const item = normalizeItem(raw, searched);
    if (!item) continue;
    items.push(item);
    // A slice closed as not planned is hidden from its build, but it's still no board item.
    for (const s of rawSlices(raw, searched.builds ?? new Set())) slices.add(refKey(s.repository.nameWithOwner, s.number));
  }
  return items.filter((i) => i.type === 'DraftIssue' || !slices.has(refKey(i.repo, i.number)));
}

const rawKey = (raw: RawItem) => refKey(raw.content?.repository?.nameWithOwner ?? null, raw.content?.number ?? null);

/** The project's own items labelled `build`, read from the project query, so the search index's lag can't miss them. */
export const projectBuilds = (raws: RawItem[]) => new Set(raws.filter((raw) => isBuild({ labels: rawLabels(raw) })).map(rawKey));

/** The issue search for `build` issues in the repos holding the builds' sub-issues that aren't on the project; null when none is off it. */
export function buildSubIssueSearch(raws: RawItem[]): string | null {
  const onProject = new Set(raws.map(rawKey));
  const repos = new Set(raws.flatMap((raw) => rawSubIssues(raw)
    .filter((s) => !onProject.has(refKey(s.repository.nameWithOwner, s.number)))
    .map((s) => `repo:${s.repository.nameWithOwner}`)));
  return repos.size ? ['is:issue label:build', ...repos].join(' ') : null;
}

/** The issue search for open issues with a slice label in the repos holding the builds' open slices; null when none is open. */
export function sliceLabelSearch(label: 'active' | 'blocked', raws: RawItem[], builds: ReadonlySet<string> = new Set()): string | null {
  const repos = new Set(raws.flatMap((raw) =>
    rawSlices(raw, builds).filter((s) => s.state === 'OPEN').map((s) => `repo:${s.repository.nameWithOwner}`)));
  return repos.size ? [`is:issue is:open label:${label}`, ...repos].join(' ') : null;
}

