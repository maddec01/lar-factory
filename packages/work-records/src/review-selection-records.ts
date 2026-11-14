import { createHash } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import { expectRevision } from './record-revision.ts';
import { reviewSelection } from './run-settings-input.ts';
import type { NewReviewRound, WorkRecords } from './work-records.ts';

interface Selection {
    workId: string;
    runId?: string;
    base: string;
    head: string;
    reviewers: {
        id: string;
        triggerVersion: 1;
        outcome: 'matched' | 'unmatched' | 'uncertain';
        rule: string;
        evidence: string;
        reason: string;
        run: boolean;
        escalation?: { requestedBy: 'code'; reason: string };
    }[];
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};

export function reviewSelectionRecords(database: Database, get: () => WorkRecords) {
    return {
        saveReviewerSelection: (id: string, input: Selection) =>
            database.write(() => {
                if (
                    !input ||
                    input.workId !== id ||
                    !/^[a-f0-9]{40}$/.test(input.base) ||
                    !/^[a-f0-9]{40}$/.test(input.head) ||
                    !Array.isArray(input.reviewers)
                )
                    invalid('Supply select-reviewers output for this work and diff.');

                for (const reviewer of input.reviewers)
                    reviewSelection(
                        {
                            triggerVersion: reviewer.triggerVersion,
                            outcome: reviewer.outcome,
                            rule: reviewer.rule,
                            evidence: reviewer.evidence,
                            reason: reviewer.reason,
                            run: reviewer.run,
                        },
                        reviewer.run ? 'approve' : 'skipped',
                    );

                get().setBuildPhase(id, get().read(id).revision, 'review');

                const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');

                database.db
                    .prepare('INSERT OR IGNORE INTO reviewer_selections(digest,work_id,content) VALUES (?,?,?)')
                    .run(digest, id, JSON.stringify(input));
            }),
        recordSelectedReviewRound: (id: string, revision: number, input: NewReviewRound) =>
            database.write(() => {
                const records = get();

                expectRevision(records.read(id), revision);

                const selections = database.db
                    .prepare('SELECT content FROM reviewer_selections WHERE work_id=? ORDER BY rowid DESC')
                    .all(id)
                    .map((row) => JSON.parse(String(row.content)) as Selection);
                const selected = selections.find(
                    (s) =>
                        (!input?.runId || s.runId === input.runId) &&
                        (s.base === input?.base ||
                            s.head === input?.base ||
                            records.reviewRounds(id).some((round) => round.runId === s.runId)),
                );

                if (
                    !input ||
                    !Array.isArray(input.reviewers) ||
                    input.reviewers.some(
                        (r) =>
                            !r ||
                            typeof r !== 'object' ||
                            (r.notChecked !== undefined && typeof r.notChecked !== 'string'),
                    )
                )
                    invalid('Supply reviewer results with optional text notes.');

                const reviewers = [...input.reviewers];
                const initial = selected && !records.reviewRounds(id).some((round) => round.runId === selected.runId);

                if (initial)
                    for (const reviewer of selected.reviewers) {
                        if (reviewers.some((result) => result.axis === reviewer.id)) continue;

                        if (reviewer.run) invalid(`Missing results for selected reviewer ${reviewer.id}.`);

                        reviewers.push({ axis: reviewer.id, verdict: 'skipped', findings: [] });
                    }

                return records.recordReviewRound(id, revision, {
                    ...input,
                    ...(selected?.runId && { runId: selected.runId }),
                    reviewers: reviewers.map((reviewer) => {
                        const match = selected?.reviewers.find((s) => s.id === reviewer.axis);
                        const selection = match
                            ? reviewSelection(
                                  {
                                      triggerVersion: match.triggerVersion,
                                      outcome: match.outcome,
                                      rule: match.rule,
                                      evidence: match.evidence,
                                      reason: match.reason,
                                      run: match.run,
                                  },
                                  reviewer.verdict,
                              )
                            : reviewer.selection;

                        if (selected && !match)
                            invalid(`Reviewer ${reviewer.axis} is absent from the saved selection.`);

                        if (
                            match &&
                            reviewer.selection &&
                            JSON.stringify(reviewSelection(reviewer.selection, reviewer.verdict)) !==
                                JSON.stringify(selection)
                        )
                            invalid('Reviewer selection differs from select-reviewers.');

                        return {
                            ...reviewer,
                            ...(selection && { selection }),
                            ...(match?.escalation && { escalation: match.escalation }),
                            notChecked: reviewer.notChecked?.trim()
                                ? reviewer.notChecked
                                : reviewer.verdict === 'skipped'
                                  ? (match?.reason ?? reviewer.notChecked)
                                  : undefined,
                        };
                    }),
                });
            }),
    };
}
