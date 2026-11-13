/** A concept run keeps its authorization when Auto-build is switched off. */
export interface ConceptBuildRun {
    state: 'running' | 'paused';
    startedAt: string;
    pausedAt?: string;
    reason?: string;
    prepared: Record<string, number>;
}

export interface ConceptBuildPlan {
    run: ConceptBuildRun | null;
    holds: { workId: string; reason: string }[];
    members: { workId: string; status: string; waits: string[]; complete: boolean }[];
}
