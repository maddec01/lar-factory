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

/** An individual build still needs concept-level prerequisites. Other builds' gates belong to the whole run. */
export function conceptPartStartHolds(plan: ConceptBuildPlan): ConceptBuildPlan['holds'] {
    const builds = new Set(plan.members.filter((member) => member.kind === 'build').map((member) => member.workId));

    return plan.holds.filter((hold) => !builds.has(hold.workId));
}

const DEPENDENCY = /^Dependency on (?:[^/:\s]+\/)?([^:\s]+):/;

/**
 * What the concept's builds wait on, in words the owner reads at a glance: decisions by whether they have started
 * ("2 decisions not started"), approvals, a Dependency by its project, and a count of anything else. Each decision and
 * gate counts once; the detailed reasons stay available separately.
 */
export function conceptBuildHoldSummary(plan: ConceptBuildPlan): string {
    const decisions = new Map<string, string>();
    const gates = new Set<string>();
    const dependencies = new Set<string>();
    const other = new Set<string>();

    for (const hold of plan.holds) {
        const member = plan.members.find((member) => member.workId === hold.workId);
        const dependency = DEPENDENCY.exec(hold.reason);

        if (member?.kind === 'decision') decisions.set(hold.workId, member.status);
        else if (/approved gate/.test(hold.reason)) gates.add(hold.workId);
        else if (dependency) dependencies.add(dependency[1]!);
        else other.add(hold.workId);
    }
    // A gate can also have a status or notice hold for the same build.
    for (const id of gates) other.delete(id);

    const words = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`;
    const notStarted = [...decisions.values()].filter((status) => status === 'Queued' || status === 'List').length;
    const open = decisions.size - notStarted;
    const parts = [
        notStarted && `${words(notStarted, 'decision')} not started`,
        open && `${words(open, 'open decision')}`,
        gates.size && words(gates.size, 'approval'),
        dependencies.size &&
            `${dependencies.size === 1 ? 'a dependency' : 'dependencies'} on ${[...dependencies].join(', ')}`,
        other.size && words(other.size, 'other hold'),
    ].filter(Boolean) as string[];

    return parts.length
        ? `Waiting on ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}`
        : '';
}
