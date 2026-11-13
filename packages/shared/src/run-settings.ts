import type { ModelChoice, ModelSelection, ModelSelectionOption } from './board-domain.ts';
import type { BuiltinReviewer, FactoryRole, FactorySettings, ReviewerMode, ThreadKind } from './factory-settings.ts';

/** Null means the provider default was unresolved, never that the requested value was confirmed. */
export interface ExecutionSettings {
    model: ModelChoice | null;
    effort: string | null;
    options: ModelSelectionOption[];
}

export interface SnapshotRunInput {
    /** Stable across retries and handoff; use a new ID only for a new logical run. */
    runId: string;
    kind: ThreadKind;
    projectDefault?: ModelSelection | null;
    threadSelection?: ModelSelection | null;
    /** The launch bridge supplies the installed package version and exact instruction text, not a mutable path. */
    packaged: { version: string; reviewers: Partial<Record<BuiltinReviewer, string>> };
    skills: string[];
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
    triggerVersion: 1;
    /** Preserve all policies, including never, without consulting later Settings. */
    settings: FactorySettings;
    thread: ExecutionSettings;
    roles: Record<FactoryRole, ExecutionSettings>;
    reviewers: RunReviewer[];
    skills: string[];
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
    executionId: string;
    /** Only values reported by T3. No report stays null, even on a failed launch. */
    report: { source: 't3'; reference: string; actual: ExecutionSettings } | null;
    result: 'completed' | 'failed';
    failure?: string;
}

export interface RoleRun extends RoleRunInput {
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
    triggerVersion: 1;
    outcome: 'matched' | 'unmatched' | 'uncertain';
    rule: string;
    evidence: string;
    reason: string;
    run: boolean;
}
