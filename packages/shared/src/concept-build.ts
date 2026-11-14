/** A concept run keeps its authorization when Auto-build is switched off. */
export interface ConceptBuildRun {
    state: 'running' | 'paused' | 'completed';
    startedAt: string;
    pausedAt?: string;
    reason?: string;
    prepared: Record<string, number>;
}

export interface ConceptBuildPlan {
    run: ConceptBuildRun | null;
    holds: { workId: string; reason: string }[];
    members: {
        workId: string;
        title: string;
        repository: string;
        kind: string;
        status: string;
        waits: string[];
        complete: boolean;
    }[];
}

/** Count each waiting decision and gate once, keeping detailed reasons available separately. */
export function conceptBuildHoldSummary(plan: ConceptBuildPlan): string {
    const decisions = new Set<string>();
    const gates = new Set<string>();
    const other = new Set<string>();

    for (const hold of plan.holds) {
        const member = plan.members.find((member) => member.workId === hold.workId);

        if (member?.kind === 'decision') decisions.add(hold.workId);
        else if (/approved gate/.test(hold.reason)) gates.add(hold.workId);
        else other.add(hold.workId);
    }
    // A gate can also have a status or notice hold for the same build.
    for (const id of gates) other.delete(id);

    const words = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`;
    const parts = [
        decisions.size && words(decisions.size, 'decision'),
        gates.size && words(gates.size, 'gate'),
        other.size && words(other.size, 'other hold'),
    ].filter(Boolean);

    return parts.length ? `Waiting on ${parts.join(' and ')}` : '';
}
