import { type Verification, type VerificationResult } from '@lar-factory/shared';
import { randomUUID } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface VerificationRecords {
    verification(workId: string): Verification;
    observeVerificationHead(workId: string, pr: string, head: string): void;
    recordVerification(workId: string, revision: number, input: Omit<VerificationResult, 'id' | 'at'>): Verification;
    verificationResume(
        workId: string,
        commandId: string,
        outcome: 'accepted' | 'rejected' | 'unconfirmed',
        error?: string,
    ): void;
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const text = (value: unknown, limit: number): string =>
    typeof value === 'string' && value.trim() && value.length <= limit && !value.includes('\0')
        ? value.trim()
        : invalid('Expected nonempty Verify text within its length limit.');
const sha = (value: unknown): string =>
    typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
        ? value
        : invalid('Expected a full PR head SHA.');

export function verificationRecords(database: Database, read: (id: string) => WorkRecord): VerificationRecords {
    const { db } = database;
    const get = (id: string): Verification => {
        read(id);

        const row = db.prepare('SELECT * FROM verification WHERE work_id=?').get(id);

        return {
            required: !!row,
            invalidated: !!row?.invalidated,
            head: (row?.head as string | null) ?? null,
            latest: row?.latest ? JSON.parse(String(row.latest)) : null,
            resume: row?.resume ? JSON.parse(String(row.resume)) : null,
        };
    };
    const bump = (id: string, status?: string) =>
        db
            .prepare(
                'UPDATE work_records SET status=coalesce(?,status), revision=revision+1, updated_at=? WHERE work_id=?',
            )
            .run(status ?? null, new Date().toISOString(), id);

    return {
        verification: (id) => database.read(() => get(id)),
        observeVerificationHead: (id, pr, head) =>
            database.write(() => {
                const record = read(id);

                if (record.pullRequest !== pr) invalid('The recorded delivery PR changed.');

                const verification = get(id);

                if (!verification.required || record.finishedAt) return;

                sha(head);

                if (verification.head === head) return;

                db.prepare('UPDATE verification SET head=?, invalidated=1 WHERE work_id=?').run(head, id);
                bump(id, record.status === 'Ready to merge' ? 'Verify' : undefined);
            }),
        recordVerification: (id, revision, input) =>
            database.write(() => {
                const record = read(id);

                if (!Number.isSafeInteger(revision) || revision !== record.revision)
                    throw new WorkRecordError('stale-revision', 'The work changed. Re-read PR head and try again.');

                if (
                    record.status !== 'Verify' ||
                    record.finishedAt ||
                    record.setAside ||
                    record.needsYou ||
                    record.needsYouCauses.length
                )
                    invalid('This work is not awaiting Verify.');

                const current = get(id);

                if (!current.required || input.pr !== record.pullRequest || sha(input.head) !== current.head)
                    invalid('The PR head changed. Refresh and test the current head.');

                if (!['pass', 'fail'].includes(input.result)) invalid('Choose pass or fail.');

                const result: VerificationResult = {
                    id: randomUUID(),
                    pr: input.pr,
                    head: input.head,
                    result: input.result,
                    by: text(input.by, 200),
                    at: new Date().toISOString(),
                    note: input.result === 'fail' ? text(input.note, 1000) : null,
                    testSteps:
                        input.result === 'pass'
                            ? text(input.testSteps, 50000)
                            : typeof input.testSteps === 'string' &&
                                input.testSteps.length <= 50000 &&
                                !input.testSteps.includes('\0')
                              ? input.testSteps.trim()
                              : invalid('Invalid PR Test steps.'),
                };
                const thread =
                    input.result === 'fail'
                        ? db
                              .prepare(
                                  "SELECT thread_id FROM threads WHERE work_id=? AND purpose='build' AND deleted_at IS NULL ORDER BY rowid DESC LIMIT 1",
                              )
                              .get(id)
                        : undefined;

                if (input.result === 'fail' && !thread)
                    invalid('The recorded build thread is unavailable. Restore it before retrying Verify.');

                const resume: Verification['resume'] = thread
                    ? {
                          threadId: String(thread.thread_id),
                          commandId: randomUUID(),
                          messageId: randomUUID(),
                          error: null,
                          sent: false,
                      }
                    : null;

                db.prepare('UPDATE verification SET latest=?, resume=?, invalidated=0 WHERE work_id=?').run(
                    JSON.stringify(result),
                    resume ? JSON.stringify(resume) : null,
                    id,
                );
                bump(id, result.result === 'pass' ? 'Ready to merge' : 'In progress');

                if (result.result === 'fail')
                    db.prepare("UPDATE work_records SET build_phase='implement' WHERE work_id=?").run(id);

                return get(id);
            }),
        verificationResume: (id, commandId, outcome, error) =>
            database.write(() => {
                const verification = get(id);
                const resume = verification.resume;

                if (!resume || resume.commandId !== commandId || resume.sent) return;

                resume.sent = outcome === 'accepted';
                resume.error = resume.sent ? null : text(error ?? 'T3 has not confirmed the Verify fix request.', 2000);

                if (outcome === 'rejected') {
                    resume.commandId = randomUUID();
                    resume.messageId = randomUUID();
                }

                db.prepare('UPDATE verification SET resume=? WHERE work_id=?').run(JSON.stringify(resume), id);
                bump(id);
            }),
    };
}
