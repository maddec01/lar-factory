import { WorkRecordError, type Database } from './database.ts';
import type { DecisionAnswers } from './decision-answers.ts';
import { cites } from './review-dependencies.ts';
import type { WorkRecord } from './work-records.ts';

/** An unresolved future is still a candidate, regardless of which retirement command is used. */
export function assertRetirementAllowed(database: Database, record: WorkRecord, answers: DecisionAnswers): void {
    const { db } = database;
    const openDecision = db
        .prepare("SELECT work_id,title FROM work_records WHERE kind='decision' AND set_aside_at IS NULL AND work_id<>?")
        .all(record.workId)
        .find((row) => {
            const state = answers.decisionAnswer(String(row.work_id));

            if (state.current || state.replacement) return false;

            const body = db
                .prepare("SELECT markdown FROM bodies WHERE work_id=? AND body='decision'")
                .get(row.work_id!);

            return cites(String(body?.markdown ?? ''), record.workId, record.title);
        });

    if (openDecision)
        throw new WorkRecordError(
            'invalid',
            `Keep this candidate and its holds until unanswered decision ${String(openDecision.title)} is answered.`,
        );
}
