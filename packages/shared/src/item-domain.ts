import { type Kind } from './board-domain.ts';
// Instructions sent to work threads; separate from board copy.
import type { ConceptBuildPlan } from './concept-build.ts';
import type { KindDisagreement } from './kind-disagreement.ts';
import type { OutcomeCheckRun } from './release-plan.ts';
import { type ItemThread, type NeedsYouOffer, type NeedsYouCause } from './thread-domain.ts';

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
export const statusLabel = (status: Exclude<Status, 'Done'>): string =>
    `${STATUS_LABEL_PREFIX}${status.toLowerCase().replaceAll(' ', '-')}`;

/** The statuses an issue's labels hold, in flow order. */
export const labelStatuses = (labels: readonly string[]): Status[] =>
    STATUSES.filter((s) => s !== 'Done' && labels.includes(statusLabel(s)));

/** Statuses only the user can move on from. */
export const AMBER_STATUSES: readonly Status[] = ['Needs you', 'Verify'];

/** A pull request's checks, and whether GitHub lets it merge. */
export interface Pipeline {
    /** The head commit's checks; null when it has none. */
    checks: Checks | null;
    mergeState: MergeState;
}

/** GitHub's merge state status, in four: CLEAN, HAS_HOOKS and UNSTABLE can merge; UNKNOWN is checking; DIRTY is conflicts; the rest blocked. */
export type MergeState = 'can merge' | 'checking' | 'blocked' | 'conflicts' | 'behind';

export interface CheckProgress {
    state: 'current' | 'stale' | 'unavailable';
    coverage?: 'all' | 'build-validation';
    observedAt?: string;
    /** Azure statuses without an iteration, separate from revision-bound checks. */
    prWideChecks?: Checks | null;
}

export interface LinkedPr extends Pipeline {
    checkProgress?: CheckProgress;
    /** Source commit observed with this PR. */
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
export const DEPENDENCY_OBSERVATION_KINDS = [
    'open',
    'closed',
    'merged',
    'reopened',
    'deleted',
    'access-lost',
    'read-failed',
] as const;

export type DependencyObservationKind = (typeof DEPENDENCY_OBSERVATION_KINDS)[number];

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
        subject: string;
        kind: DependencyObservationKind;
        detail: string | null;
        observedAt: string;
        /** The last read that answered, kept beside a read that failed or lost access; null after a read that answered. */
        lastGood: { kind: DependencyObservationKind; observedAt: string } | null;
    } | null;
}

/**
 * Work blocking an item: closed once its work record's local facts complete it. A record's blocker names its work ID and
 * title; its number is 0 without a ticket. A Dependency's blocker carries `dependency` and is closed once marked met.
 */
export type Blocker = Pick<IssueRef, 'number' | 'repo' | 'state'> & {
    workId?: string;
    title?: string;
    dependency?: DependencyHold;
};

/** The blockers whose work isn't complete yet, or whose Dependency isn't marked met: what holds its start, its badge and Start after. */
export const openBlockers = (item: Pick<Item, 'blockers'>): Blocker[] =>
    item.blockers.filter((b) => b.state === 'open');

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
    /** Boundaries under Out of scope. */
    boundaries?: string[];
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
export const usageFailed = (item: Item): boolean =>
    usageIncomplete(item) &&
    (item.stats === 'unavailable' ||
        item.usageState === 'failed' ||
        (item.threads === 'unavailable' && item.usageState !== 'loading'));

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
    /** Stable creation facts for group display order, independent of Queue and approval renewal. */
    createdAt?: string;
    partOrder?: number;
    /** Retired children stay inspectable within their group, outside the active board and scheduler. */
    retiredParts?: Item[];
    setAside?: boolean;
    supersededBy?: IssueRef & { workId: string };
    outcomeCheck?: { ready: boolean; digest: string; run: OutcomeCheckRun | null };
    releasePlan?: import('./release-plan.ts').ReleasePlan | null;
    retro?: import('./retro.ts').Retro | null;
    reconciliation?: import('./group-reconciliation.ts').ReconcileReport;
    verification?: import('./verification.ts').Verification;
    /** Local completion facts, independent of the board Status and absent on provider-only items. Never published. */
    completion?: { complete: boolean; reasons: string[] };
    conceptBuild?: ConceptBuildPlan;
    refinement?: { complete: boolean; reasons: string[] };
    ticketEditHeld?: true;
    specSync?: { pending: boolean; error: string | null; warning: string | null };
    sync?: { state: 'saved' | 'pending' | 'error' | 'conflict'; message?: string };
    /** Public tracker structure, also present before this machine queues the issue. */
    tracker?: import('./tracker-structure.ts').TrackerStructure;
    /** False for an issue from the list that has no local work record yet. */
    recorded?: boolean;
    /** Eligibility from the durable journal, independent of Status. Absent for decisions and slices. */
    passingBrief?: boolean;
    briefChangesRequested?: true;
    staleGateDetail?: string;
    staleGate?: 'brief' | 'sources' | 'approval';
    /** The current brief package lacks Doubt; only live thread evidence may say reviewing. */
    briefReviewing?: true;
    /** Durable delivery evidence, including a branch awaiting owner recovery. */
    buildStarted?: true;
    /** Authoritative local reservation, shared with the atomic build claim; absent on provider-only items. */
    buildReserved?: boolean;
    briefApproval?: { reason: string; digest?: string };
    publication?: Pick<import('./publication.ts').PublicationReadiness, 'eligible' | 'reasons'> & {
        recoverable?: boolean;
    };
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
    /** Board flow, projected from typed work relationships; private build slices never make it linked. */
    flow: 'single' | 'linked';
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
    /** Its local parent’s work ID, falling back to a tracker parent’s local record; null when no parent is on this machine. */
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
    needsYou?: {
        reason: string;
        offers: NeedsYouOffer[];
        causes: NeedsYouCause[];
        ticketOpen: boolean;
        deletedThread?: boolean;
        startAgainPurpose?: 'shape' | 'build';
        hasOtherNote?: boolean;
    };
    /** Why the board couldn't clean up its shaping threads yet, which it keeps trying; shown in item details only. */
    shapingCleanupProblem?: string;
    /** Set on work off the board in Archive: set aside, which Restore brings back, or finished and hidden by retention. */
    archived?: { setAside: boolean; hidden: boolean; ticketOpen: boolean };
}
