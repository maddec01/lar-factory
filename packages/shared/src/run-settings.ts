import type { ModelChoice, ModelSelection, ModelSelectionOption } from './board-domain.ts';
import type { BuiltinReviewer, FactoryRole, FactorySettings, ReviewerMode, ThreadKind } from './factory-settings.ts';

export interface TestRuntime {
    node: string;
    version: string;
}

/** Null means the provider default was unresolved, never that the requested value was confirmed. */
export interface ExecutionSettings {
    model: ModelChoice | null;
    effort: string | null;
    options: ModelSelectionOption[];
}

/** The running app release the desktop app gives the board server; only a packaged app sets it. */
export const APP_RELEASE_ENV = 'BOARD_APP_VERSION';

/** Whether `value` can name a release folder: one nonempty path segment, never `.` or `..`. */
export const isRelease = (value: unknown): value is string =>
    typeof value === 'string' && /^[\w.+-]+$/.test(value) && value !== '.' && value !== '..';

/** How a project's builds work: test first (TDD), or Prove it. */
export const BUILD_METHODS = ['tdd', 'prove-it'] as const;

export type BuildMethod = (typeof BUILD_METHODS)[number];

export const isBuildMethod = (value: unknown): value is BuildMethod => BUILD_METHODS.includes(value as BuildMethod);

/** The runtime blocks' line naming a run's frozen Build method; a run saved without one is TDD. */
export const frozenBuildMethodLine = (run: Pick<RunSettings, 'buildMethod'>): string =>
    `Frozen build method: ${run.buildMethod === 'prove-it' ? 'Prove it' : 'TDD'}`;

/** The runtime blocks' line saying whether a run's frozen factory settings end its build with a Retro. */
export const frozenRetroLine = (run: Pick<RunSettings, 'settings'>): string =>
    `Frozen retro: ${run.settings.retro === false ? 'off' : 'on'}`;

export interface SnapshotRunInput {
    /** Stable across retries and handoff; use a new ID only for a new logical run. */
    runId: string;
    kind: ThreadKind;
    projectDefault?: ModelSelection | null;
    threadSelection?: ModelSelection | null;
    /** The launch bridge supplies the installed package version and exact instruction text, not a mutable path. */
    packaged: { version: string; reviewers: Partial<Record<BuiltinReviewer, string>> };
    skills: string[];
    /** The app release the run starts on, which names its release folder; absent without a packaged app. */
    release?: string;
    /** The project's Build method as the run starts; TDD when absent. */
    buildMethod?: BuildMethod;
}

export interface RunReviewer {
    id: string;
    name: string;
    mode: ReviewerMode;
    instructions: {
        source: { kind: 'packaged'; version: string; path: string } | { kind: 'custom'; revision: number };
        text: string;
        digest: string;
    };
}

export interface RunSettings {
    version: 1;
    runId: string;
    workId: string;
    kind: ThreadKind;
    capturedAt: string;
    settingsDigest: string;
    /** Resolved at run creation for every kind; roles and slices use this value. Absent on legacy runs. */
    testRuntime?: TestRuntime;
    triggerVersion: 1;
    /** Preserve all policies, including never, without consulting later Settings. */
    settings: FactorySettings;
    thread: ExecutionSettings;
    roles: Record<FactoryRole, ExecutionSettings>;
    reviewers: RunReviewer[];
    skills: string[];
    /** The app release the run started on; absent on runs started without a packaged app and on runs saved before releases. */
    release?: string;
    /** The project's Build method the run started with; absent on runs saved before Build methods, which are TDD. */
    buildMethod?: BuildMethod;
}

export interface RoleRunInput {
    runId: string;
    executionId: string;
    role: FactoryRole | 'thread';
    threadId?: string;
    taskId?: string;
    /** Exact capability-resolved delegate options, retained for the command's finish comparison. */
    launchOptions?: ModelSelectionOption[];
}

export interface RoleRunFinish {
    summary?: string;
    executionId: string;
    /** Only values reported by T3. No report stays null, even on a failed launch. */
    report: { source: 't3'; reference: string; actual: ExecutionSettings } | null;
    result: 'completed' | 'failed';
    failure?: string;
}

/** The role-launch request becomes this T3 task ID; never match another attempt by title. */
export function roleTaskMatches(attempt: Pick<RoleRunInput, 'executionId' | 'taskId'>, reference: string): boolean {
    if (attempt.taskId) return attempt.taskId === reference;

    try {
        return (
            reference.startsWith('node:delegated-task:') &&
            decodeURIComponent(reference).endsWith(`:delegate-task:${attempt.executionId}`)
        );
    } catch {
        return false;
    }
}

export interface RoleRun extends RoleRunInput {
    /** Only reconciliation's inference may be replaced by the matching terminal T3 result. */
    inferredAbandonment?: boolean;
    /** An agent/system wait, never a product question for Pedro. */
    reconciliationHold?: string;
    summary?: string;
    workId: string;
    requested: ExecutionSettings;
    actual: ExecutionSettings | null;
    report: RoleRunFinish['report'];
    startedAt: string;
    endedAt: string | null;
    result: 'running' | RoleRunFinish['result'];
    failure: string | null;
}

/** Versioned trigger evidence kept with a review, including skips and uncertain matches. */
export interface ReviewSelectionEvidence {
    triggerVersion: 1 | 2;
    outcome: 'matched' | 'unmatched' | 'uncertain';
    rule: string;
    evidence: string;
    reason: string;
    run: boolean;
}
