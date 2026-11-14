import type { RecordDetails } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Selection is visible before launches; only terminal evidence supplies a result. */
export function reviewerProgress(records: WorkRecords, id: string): RecordDetails['reviewers'] {
    const selection = records.reviewerSelection(id);

    if (!selection) return undefined;

    const roles = records.runSettings(id, selection.runId).roleRuns;
    const rounds = records
        .reviewRounds(id)
        .filter(
            (round) =>
                round.recordedAt >= selection.selectedAt && (!selection.runId || round.runId === selection.runId),
        );

    return selection.reviewers.map((reviewer) => {
        const role = roles
            .filter((run) => run.role === `reviewer:${reviewer.id}` && run.startedAt >= selection.selectedAt)
            .at(-1);
        const verdict = rounds.at(-1)?.reviewers.find((axis) => axis.axis === reviewer.id);

        return {
            id: reviewer.id,
            name: reviewer.name,
            reason: reviewer.reason,
            status: !reviewer.run
                ? 'Skipped'
                : verdict
                  ? verdict.verdict === 'approve'
                      ? 'Approved'
                      : 'Changes requested'
                  : role?.result === 'running'
                    ? 'Running'
                    : role?.result === 'failed'
                      ? 'Failed'
                      : role?.result === 'completed'
                        ? 'Completed'
                        : 'Waiting',
            ...(verdict
                ? {
                      result: `${verdict.findings.filter((finding) => finding.disposition === 'open').length} open findings${verdict.notChecked ? ` · ${verdict.notChecked}` : ''}`,
                  }
                : role?.failure
                  ? { result: role.failure }
                  : role?.result === 'completed'
                    ? { result: role.summary ?? 'Review finished; verdict not yet recorded.' }
                    : {}),
        };
    });
}
