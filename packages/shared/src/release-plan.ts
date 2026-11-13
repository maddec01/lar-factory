/** Local delivery evidence for a concept or linked-work parent. Step order is execution order. */
export interface ReleaseEvidence {
    by: string;
    evidence: string;
    at: string;
}
export interface ReleasePlan {
    steps: { id: string; who: string; what: string; done: ReleaseEvidence | null }[];
    outcomeCheck: { what: string; result: 'pending' | 'passed' | 'failed'; evidence: ReleaseEvidence | null };
}

export function releaseHolds(plan: ReleasePlan | null | undefined): string[] {
    if (!plan) return [];

    return [
        ...plan.steps
            .filter((step) => !step.done)
            .map((step) => `Release step ${step.id}: ${step.who} must ${step.what}`),
        ...(plan.outcomeCheck.result !== 'passed'
            ? [`Outcome check ${plan.outcomeCheck.result}: ${plan.outcomeCheck.what}`]
            : []),
    ];
}
