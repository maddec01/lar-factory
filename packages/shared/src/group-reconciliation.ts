/** Record-backed group upkeep; a fingerprint binds completion to the exact inputs reviewed. */
export interface ReconcileItem {
    key: string;
    digest: string;
    kind: 'map' | 'brief' | 'gate' | 'blocker' | 'ticket' | 'dependency' | 'release';
    workId: string;
    summary: string;
    changes: string[];
    requiresFix: boolean;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
}
export interface ReconcileReport {
    groupId: string;
    digest: string;
    items: ReconcileItem[];
    completed: { key: string; digest: string; evidence: string }[];
    /** The checklist the last `reconcile` or `resolveReconcile` saved; automatic reconciliation reads it. */
    pending?: ReconcileItem[];
}

const LIFECYCLE = ['status', 'queueOrder', 'finishedAt'];
const only = (item: ReconcileItem, fields: string[]) =>
    item.changes.length > 0 && item.changes.every((field) => fields.includes(field));

/** A map item whose only changes are Status, queue order or finish time, which the board resolves after a merge. */
export const lifecycleOnly = (item: ReconcileItem): boolean =>
    !item.requiresFix && item.key.startsWith('map:') && only(item, LIFECYCLE);

/** A map item a merge may have produced: its part finished, or was added already finished. A merged PR observation confirms it. */
export const mergeShaped = (item: ReconcileItem): boolean =>
    item.key.startsWith('map:') &&
    (item.changes.includes('finishedAt') || item.changes.includes('added')) &&
    !!item.after?.finishedAt;

/**
 * A merge-shaped item the saved checklist has not seen, whose part the board already shows with a merged PR: the
 * board's read-free test before its pass after a merge. A part finished without a merged PR, such as a decision, never
 * passes it, so its group is not read again on every refresh. The pass itself still confirms the merge observation.
 */
export const unseenMerge = (report: ReconcileReport, merged: (workId: string) => boolean): boolean =>
    report.items.some(
        (item) =>
            mergeShaped(item) &&
            merged(item.workId) &&
            !report.pending?.some((old) => old.key === item.key && old.digest === item.digest),
    );

/** Items the release step and Outcome flows settle, whichever command changed them. */
export const releaseOwned = (item: ReconcileItem): boolean =>
    item.key.startsWith('release-evidence:') ||
    item.key.startsWith('outcome:') ||
    (item.key.startsWith('release:') && only(item, ['evidence'])) ||
    (item.key.startsWith('release-outcome:') && only(item, ['result', 'evidence']));

/** The saved checklist items that need a thread's judgement: neither lifecycle-only nor owned by release or Outcome. */
export const reconcileWaitItems = (report: ReconcileReport | undefined): ReconcileItem[] =>
    (report?.pending ?? []).filter((item) => !lifecycleOnly(item) && !releaseOwned(item));

export interface ReleaseStep {
    id: string;
    title: string;
    who?: string;
    kind: 'ships-with' | 'step';
    workIds: string[];
    evidence: string | null;
}
