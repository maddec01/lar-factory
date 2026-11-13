// Instructions sent to work threads; separate from board copy.

import type { SkillStatus } from './install-skills.ts';
import { type Item, type Checks, type CheckState, type Pipeline, SLOW_CHECKS_MS } from './item-domain.ts';
import type { RepositorySetup, OnboardingRepository, ProjectIcon } from './model-settings.ts';
import type { ToolChecks, ToolProgress } from './model-tools.ts';
import { type StartedThread, type StartPurpose, type StartProgress } from './thread-domain.ts';

/** A model Start offers: T3's name for it, else its slug. */
export interface ModelOption {
    slug: string;
    label: string;
    /** Advertised reasoning choices, when T3 reports them. */
    efforts?: { value: string; label: string }[];
}

/** An enabled T3 provider instance, named as T3's picker names it, and the models Start offers on it. */
export interface ModelGroup {
    instanceId: string;
    name: string;
    models: ModelOption[];
}

/** The provider instance and model a new thread runs on; none leaves it to T3 ("Project default in T3"). */
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

/** The Project default in T3 of the item's repository, whatever the case. */
export function repositoryT3Default(data: Pick<BoardData, 't3Defaults'>, repo: string): ModelSelection | undefined {
    return Object.entries(data.t3Defaults ?? {}).find(([r]) => sameRepo(r, repo))?.[1];
}

/** A blocked part's start, armed by Start after: the board starts it on this model choice once every issue it's blocked by closes. */
export interface ArmedStart {
    /** None leaves it to T3 ("Project default in T3"). */
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
     * its tool; absent until the board knows them, and empty once none waits. The board shows the landed repositories'
     * items meanwhile.
     */
    waiting?: string[];
    /** Whether the read finished, failed, or gh blocked it. A settled first read stays settled until the server restarts. */
    settled: boolean;
    /** Available local work or a successful source allows access before all sources settle. */
    ready?: boolean;
}

/** The first read once it has settled, which is how sample mode starts. */
export const SETTLED_FIRST_READ: FirstRead = { step: 'finishing', running: [], settled: true };

export interface BoardData {
    /** A local process problem; cached items remain available while it needs attention. */
    localProblem?: string;
    /** Sanitized authenticated source state. Credentials stay in the server. */
    t3Availability?: {
        availability: 'available' | 'unavailable' | 'renewal-required' | 'unsupported-version' | 'malformed';
        observedAt?: string;
    };
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
    /** The model choices Start offers besides "Project default in T3"; empty when T3's settings or model list can't be read. */
    modelChoices: ModelGroup[];
    /** Each repository's effective Project default in T3, for the Project default in T3 entry; a repository whose default can't be read has none. Absent in sample mode. */
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

export type ShapingThreadCleanup = (typeof SHAPING_THREAD_CLEANUPS)[number];

export type ShapingThreadCleanupState = { choice: ShapingThreadCleanup } | { problem: string };

/** How many heavy commands may run at once on this machine, across all builds and worktrees: Automatic, or a whole number from 1. */
export type HeavyCommandLimit = 'automatic' | number;

/** The saved limit, the number Automatic gives on this machine, and why a file that couldn't be read or held an invalid value counts as Automatic. */
export interface HeavyCommandLimitState {
    limit: HeavyCommandLimit;
    automatic: number;
    problem?: string;
}

/** How many builds may work at once on this machine: Automatic, which follows the heavy command limit, or a whole number from 1. */
export type BuildLimit = HeavyCommandLimit;

export type BuildLimitState = HeavyCommandLimitState;

/** This machine's Auto-build: whether the board starts eligible Ready builds by itself, and on which model; none leaves it to T3 ("Project default in T3"). */
export interface AutoBuild {
    on: boolean;
    model?: ModelChoice;
}

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
export const limitNumber = ({ limit, automatic }: HeavyCommandLimitState): number =>
    limit === 'automatic' ? automatic : limit;

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

/** Whether the repository is on this Mac's list still onboarding, whatever the case. */
export function isOnboarding(data: Pick<BoardData, 'onboarding'>, repo: string | null): boolean {
    return repo !== null && Boolean(data.onboarding?.some((o) => sameRepo(o.repo, repo)));
}

// ---------- kinds ----------

export type Kind = 'bug' | 'feature' | 'improvement' | 'concept' | 'decision' | 'build' | 'issue';

export function decisionType(item: Item): string | null {
    if (item.decisionMethod !== undefined) return item.decisionMethod;

    const label = item.labels.find((l) => l.startsWith('decision-'));

    return label ? label.slice('decision-'.length) : null;
}

/** A decision records its method on the first line, independently of tracker labels. */
export function parseDecisionMethod(body: string): Item['decisionMethod'] {
    const method = /^Method:\s*(grill|prototype|research|task)\s*$/i
        .exec(body.split('\n')[0]?.trim() ?? '')?.[1]
        ?.toLowerCase();

    return (method as Item['decisionMethod']) ?? null;
}

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

/** Failure takes precedence while other checks run; otherwise running, then passed. */
export function checkState(checks: Checks | null): CheckState | null {
    if (!checks) return null;

    if (checks.failed) return 'failed';

    return checks.running ? 'running' : checks.passed === checks.total ? 'passed' : null;
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
 * items land, which, before the board knows which repositories wait, is every repository.
 */
export const readingScope = (data: Pick<BoardData, 'firstRead'>, repo?: string): boolean =>
    !data.firstRead.settled && (!repo || !data.firstRead.waiting || stillReading(data, repo));

/** Whether the item shows in the repository's List and Scope: it's the item's repository, or one of its untagged repositories. */
export const inRepo = (item: Pick<Item, 'repo' | 'untaggedFor'>, repo: string): boolean =>
    sameRepo(repoKey(item), repo) || Boolean(item.untaggedFor?.some((r) => sameRepo(r, repo)));

/** Whether a repository is on Azure DevOps: organization/project/repository, not GitHub's owner/name. */
export const onAzure = (repo: string): boolean => repo.split('/').length === 3;

/** A part of a repository's key as people read it: an Azure DevOps origin's `Fabrikam%20Fiber` is `Fabrikam Fiber`. */
export const decodePart = (part: string): string => {
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
};

const REPO_TAG_PREFIX = 'repo-';

/** The tag that records an Azure work item's repository: repo- and the repository's name as Azure shows it. */
export const repoTag = (repo: string): string => `${REPO_TAG_PREFIX}${decodePart(repo.split('/').at(-1)!)}`;

/** Whether the tag records a work item's repository; Azure keeps a tag's case, so the board ignores it. */
export const isRepoTag = (tag: string): boolean => tag.trim().toLowerCase().startsWith(REPO_TAG_PREFIX);

/** Abandon closes a List or Queued issue. */
export function canAbandon(item: Item): boolean {
    return item.status === 'List' || item.status === 'Queued';
}

/** Whether the data is stale: the latest read failed, or none succeeded for 3 intervals. A first read still running isn't. */
export function isStale(data: BoardData, now: number): boolean {
    if (data.error) return true;

    if (!data.fetchedAt) return false;

    return now - Date.parse(data.fetchedAt) > data.refreshSeconds * 3 * 1000;
}

/** Whether the board can't trust what it knows of thread activity: the page's read failed, the data is stale or the first read hasn't settled. */
export function activityUnavailable(data: BoardData, now: number, clientError?: string | null): boolean {
    return !!clientError || isStale(data, now) || !data.firstRead.settled;
}
