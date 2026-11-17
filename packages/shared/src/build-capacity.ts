/** One reservation policy for starts, automatic scheduling, questions, handoffs and recovery. */
export function reservesBuildSlot(work: {
    kind: string;
    status: string;
    retired: boolean;
    complete?: boolean;
    coordinating: boolean;
    deliveryStarted: boolean;
    /** The build links a PR: it waits on that PR, or the PR closed or merged. Either way it holds no slot. */
    pullRequest: boolean;
}): boolean {
    return (
        !['concept', 'decision', 'slice'].includes(work.kind) &&
        !['List', 'Queued'].includes(work.status) &&
        !work.retired &&
        !(work.complete ?? work.status === 'Done') &&
        !work.coordinating &&
        work.deliveryStarted &&
        !work.pullRequest
    );
}
