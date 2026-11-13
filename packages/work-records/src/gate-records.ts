import type { GateEvidence, GateResult } from '@lar-factory/shared';
import { createHash, randomUUID } from 'node:crypto';

import { agentRevision } from './agent-revision.ts';
import type { BriefReviewRecords } from './brief-review.ts';
import { checkBriefScope } from './brief-scope.ts';
import { WorkRecordError, type Database } from './database.ts';
import {
    gateManifest,
    gateWorkIds,
    readGateManifest,
    type GateManifest,
    type GateBatchEvidence,
} from './gate-batch.ts';
import { makeGateDisplay, verifyGateDisplay, type GateDisplay, type GateApproval } from './gate-display.ts';
import { storedScope } from './scope-records.ts';
import { queueTicketSpec } from './spec-records.ts';
import type { WorkRecord } from './work-records.ts';

export interface GateRecords {
    gate(workId: string): GateResult;
    gateBatch(workIds: string[]): GateManifest;
    recordGateBatch(manifest: GateManifest, digest: string, approvedBy: string, evidence: string): GateBatchEvidence;
    displayGate(workId: string): GateDisplay;
    recordDisplayedGate(
        display: GateDisplay,
        approvalDigest: string,
        approvedBy: string,
        evidence: string,
    ): GateEvidence;
    recordGate(workId: string, revision: number, evidence: GateApproval): GateEvidence;
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const filled = (value: unknown, name: string): string => {
    if (typeof value !== 'string' || !value.trim()) return invalid(`The ${name} is empty or isn't text.`);

    return value;
};
const object = (value: unknown): Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('Expected an object.');

    return value as Record<string, unknown>;
};
const keys = (value: unknown, allowed: string[]) => {
    for (const key of Object.keys(object(value)))
        if (!allowed.includes(key)) invalid(`Unexpected publication field ${key}.`);
};
const integer = (value: unknown, name: string, minimum = 1): number =>
    Number.isSafeInteger(value) && Number(value) >= minimum
        ? Number(value)
        : invalid(`The ${name} must be a whole number from ${minimum}.`);
const digest = (value: string) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();

/** Owns brief gate evidence and approval transactions, including the queued Spec write. */
export function gateRecords(
    database: Database,
    readRecord: (workId: string) => WorkRecord,
    reviews: Pick<BriefReviewRecords, 'currentDoubt'>,
): GateRecords {
    const { db } = database;
    const find = (workId: string) => readRecord(workId);
    const expected = (workId: string, revision: number) => {
        const record = find(workId);

        integer(revision, 'revision');

        if (record.revision !== revision)
            throw new WorkRecordError(
                'stale-revision',
                `The work record ${workId} is at revision ${record.revision}, not ${revision}; read it again and retry.`,
            );

        return record;
    };
    const body = (workId: string, name: string) =>
        db.prepare('SELECT markdown FROM bodies WHERE work_id = ? AND body = ?').get(workId, name)?.markdown as
            | string
            | undefined;
    const gate = (workId: string): GateResult => {
        find(workId);

        const brief = body(workId, 'brief');
        const briefDigest = brief?.trim() ? digest(brief) : null;
        const evidence = db
            .prepare('SELECT * FROM brief_gates WHERE work_id = ? ORDER BY rowid')
            .all(workId)
            .map((row): GateEvidence => ({
                gateId: String(row.gate_id),
                workId,
                sourceRevision: Number(row.source_revision),
                briefDigest: String(row.brief_digest),
                approvedBy: String(row.approved_by),
                evidence: String(row.evidence),
                recordedAt: String(row.recorded_at),
                source: row.source as GateEvidence['source'],
                ...(row.batch_digest ? { batchDigest: String(row.batch_digest) } : {}),
                ...(row.approval_digest ? { approvalDigest: String(row.approval_digest) } : {}),
                ...(row.review_digest
                    ? { reviewDigest: String(row.review_digest), doubtReviewId: String(row.doubt_review_id) }
                    : {}),
            }));
        const passed = db
            .prepare(
                "SELECT gate_id, review_digest FROM brief_gates WHERE work_id = ? AND brief_digest = ? AND invalidated = 0 AND source IN ('gate', 'user') ORDER BY rowid DESC LIMIT 1",
            )
            .get(workId, briefDigest);
        const scope = storedScope(database, workId);
        const matchesScope = !scope || checkBriefScope(scope.scope, brief ?? null).ok;
        const matchesReview =
            !passed?.review_digest || reviews.currentDoubt(workId)?.packageDigest === passed.review_digest;
        const passing =
            matchesScope && matchesReview ? (evidence.find((item) => item.gateId === passed?.gate_id) ?? null) : null;

        return { briefDigest, current: passing !== null, passing, evidence };
    };
    const saveGate = (workId: string, revision: number, value: GateApproval): GateEvidence => {
        const record = expected(workId, revision);

        keys(value, ['briefDigest', 'approvedBy', 'evidence', 'approvalDigest', 'reviewDigest', 'batchDigest']);

        if (['concept', 'decision', 'slice'].includes(record.kind))
            invalid('Only a publishable brief can pass a gate.');

        const current = gate(workId);

        if (!current.briefDigest || current.briefDigest !== value.briefDigest)
            invalid('The brief changed or is missing; inspect it before recording its gate.');

        const review = reviews.currentDoubt(workId);

        if (value.reviewDigest !== undefined && value.reviewDigest !== review?.packageDigest)
            invalid('The affected-work package changed; rerun Doubt before approval.');

        const scope = storedScope(database, workId);

        if (scope && !checkBriefScope(scope.scope, body(workId, 'brief') ?? null).ok)
            invalid('The brief differs from confirmed scope. Run brief-scope-check before presenting its gate.');

        const item: GateEvidence = {
            ...(review ? { reviewDigest: review.packageDigest, doubtReviewId: review.reviewId } : {}),
            ...(value.approvalDigest ? { approvalDigest: value.approvalDigest } : {}),
            ...(value.batchDigest ? { batchDigest: value.batchDigest } : {}),
            gateId: randomUUID(),
            workId,
            sourceRevision: revision,
            briefDigest: current.briefDigest!,
            approvedBy: filled(value.approvedBy, 'gate approval identity'),
            evidence: filled(value.evidence, 'gate evidence'),
            recordedAt: now(),
        };

        db.prepare(
            'INSERT INTO brief_gates (gate_id, work_id, source_revision, brief_digest, approved_by, evidence, recorded_at, approval_digest, review_digest, doubt_review_id, batch_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
            item.gateId,
            workId,
            revision,
            item.briefDigest,
            item.approvedBy,
            item.evidence,
            item.recordedAt,
            item.approvalDigest ?? null,
            item.reviewDigest ?? null,
            item.doubtReviewId ?? null,
            item.batchDigest ?? null,
        );
        db.prepare("UPDATE bodies SET has_passing_gate = 1 WHERE work_id = ? AND body = 'brief'").run(workId);

        if (record.ticket) queueTicketSpec(database, workId, record.ticket, body(workId, 'brief')!);

        return item;
    };
    const displayGate = (workId: string): GateDisplay => {
        const record = find(workId);
        const brief = body(workId, 'brief');

        if (!brief?.trim()) invalid('A gate needs a complete brief.');

        const scope = storedScope(database, workId);

        if (scope && !checkBriefScope(scope.scope, brief ?? null).ok)
            invalid('The brief differs from confirmed scope. Run brief-scope-check before presenting its gate.');

        return makeGateDisplay(workId, record.revision, brief!);
    };

    const gateBatch = (workIds: string[]): GateManifest =>
        gateManifest(
            gateWorkIds(workIds).map((id) => {
                if (
                    db
                        .prepare(
                            "SELECT 1 FROM ticket_specs WHERE work_id = ? AND json_extract(state, '$.held') IS NOT NULL",
                        )
                        .get(id)
                )
                    invalid(`Resolve the held Spec edit for ${id} before gating this batch.`);

                const display = displayGate(id);
                const doubt = reviews.currentDoubt(id);

                if (!doubt)
                    invalid(
                        `Run Doubt and record-doubt for the current package of ${id} before displaying this batch.`,
                    );

                return { display, doubt: doubt! };
            }),
        );

    return {
        gate: (workId) => database.read(() => gate(workId)),
        // Hold one SQLite snapshot for every displayed member, just as approval does.
        gateBatch: (ids) => database.write(() => gateBatch(ids)),
        recordGateBatch: (manifest, approvedDigest, approvedBy, evidence) =>
            database.write(() => {
                const displayed = readGateManifest(manifest);

                if (displayed.digest !== approvedDigest)
                    invalid('The approved batch digest does not match the displayed manifest.');

                // Preserve the approved manifest while checking disjoint progress under the same write lock.
                const revisions = displayed.members.map(({ display }) =>
                    agentRevision(database, display.workId, display.sourceRevision, [
                        'kind',
                        'setAsideAt',
                        'finishedAt',
                        'body.brief',
                        'gate',
                        'ticket',
                        'confirmedScope',
                    ]),
                );
                const current = gateBatch(displayed.members.map((member) => member.display.workId));

                const compared = gateManifest(
                    current.members.map((member, index) => ({
                        ...member,
                        display: makeGateDisplay(
                            member.display.workId,
                            displayed.members[index]!.display.sourceRevision,
                            member.display.brief,
                        ),
                    })),
                );

                if (compared.digest !== approvedDigest)
                    invalid(
                        'A displayed batch member changed; review and display the complete batch for renewed approval.',
                    );

                const gates = displayed.members.map(({ display, doubt }, index) =>
                    saveGate(display.workId, revisions[index]!, {
                        briefDigest: display.briefDigest,
                        approvalDigest: display.approvalDigest,
                        reviewDigest: doubt.packageDigest,
                        batchDigest: displayed.digest,
                        approvedBy,
                        evidence,
                    }),
                );

                return {
                    digest: displayed.digest,
                    manifest: displayed,
                    approvedBy,
                    evidence,
                    recordedAt: now(),
                    gates,
                };
            }),
        recordGate: (workId, revision, value) => database.write(() => saveGate(workId, revision, value)),
        displayGate: (workId) => database.read(() => displayGate(workId)),
        recordDisplayedGate: (display, approvalDigest, approvedBy, evidence) =>
            database.write(() => {
                verifyGateDisplay(display, approvalDigest, displayGate(display.workId));

                const review = reviews.currentDoubt(display.workId);

                if (!review) invalid('Run Doubt on the current doubt-package and record-doubt before approval.');

                return saveGate(display.workId, display.sourceRevision, {
                    briefDigest: display.briefDigest,
                    approvedBy,
                    evidence,
                    approvalDigest,
                    reviewDigest: review!.packageDigest,
                });
            }),
    };
}
