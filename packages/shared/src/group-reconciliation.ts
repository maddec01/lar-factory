/** Record-backed group upkeep; a fingerprint binds completion to the exact inputs reviewed. */
export interface ReconcileItem {
    key: string;
    digest: string;
    kind: 'map' | 'brief' | 'gate' | 'overlap' | 'blocker' | 'ticket' | 'dependency' | 'release';
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
}
export interface ReleaseStep {
    id: string;
    title: string;
    who?: string;
    kind: 'ships-with' | 'step';
    workIds: string[];
    evidence: string | null;
}
