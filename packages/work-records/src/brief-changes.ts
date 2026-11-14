import type { BriefChangeRequest } from '@lar-factory/shared';
import { randomUUID } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import { verifyGateDisplay, type GateDisplay } from './gate-display.ts';
import { gateOwner } from './gate-resume.ts';
import type { WorkRecord } from './work-records.ts';

export interface BriefChangeRecords {
    briefChangeRequests(id: string): BriefChangeRequest[];
    requestBriefChanges(displays: GateDisplay[], note: string, by: string): BriefChangeRequest[];
    briefChangesDelivered(
        id: string,
        requestId: string,
        outcome: 'accepted' | 'rejected' | 'unconfirmed',
        error?: string,
    ): void;
}

/** A request changes workflow, never approved text or prior approval evidence. Delivery survives retries. */
export function briefChangeRecords(
    database: Database,
    read: (id: string) => WorkRecord,
    display: (id: string) => GateDisplay,
): BriefChangeRecords {
    const { db } = database;
    const list = (id: string) =>
        db
            .prepare('SELECT content FROM brief_change_requests WHERE work_id=? ORDER BY rowid')
            .all(id)
            .map((row) => JSON.parse(String(row.content)) as BriefChangeRequest);
    const save = (id: string, request: BriefChangeRequest) =>
        db
            .prepare('UPDATE brief_change_requests SET content=? WHERE work_id=? AND request_id=?')
            .run(JSON.stringify(request), id, request.requestId);

    return {
        briefChangeRequests: (id) =>
            database.read(() => {
                read(id);

                return list(id);
            }),
        requestBriefChanges: (displays, note, by) =>
            database.write(() => {
                if (!displays.length || typeof note !== 'string' || !note.trim() || note.length > 10000 || !by.trim())
                    throw new WorkRecordError('invalid', 'Write a change request of 1–10000 characters.');

                for (const shown of displays) {
                    const record = read(shown.workId);

                    if (record.finishedAt || record.setAside)
                        throw new WorkRecordError('invalid', 'This brief is no longer active.');

                    verifyGateDisplay(shown, shown.approvalDigest, display(shown.workId));
                }

                const owners = displays.map((shown) => gateOwner(database, read(shown.workId), 'shape'));

                if (owners.some((owner) => !owner))
                    throw new WorkRecordError(
                        'invalid',
                        'No shaping owner is recorded. Start shaping before requesting changes.',
                    );

                const deliveries = new Map<string, BriefChangeRequest['delivery']>();

                owners.forEach((owner, index) => {
                    let delivery = deliveries.get(owner!.threadId);

                    if (!delivery) {
                        delivery = {
                            ownerWorkId: owner!.workId,
                            threadId: owner!.threadId,
                            workIds: [],
                            commandId: randomUUID(),
                            messageId: randomUUID(),
                            sent: false,
                            error: null,
                        };
                        deliveries.set(owner!.threadId, delivery);
                    }

                    delivery.workIds!.push(displays[index]!.workId);
                });

                const at = new Date().toISOString();

                return displays.map((shown, index) => {
                    const owner = owners[index]!;
                    const request: BriefChangeRequest = {
                        requestId: randomUUID(),
                        note: note.trim(),
                        by,
                        at,
                        briefDigest: shown.briefDigest,
                        delivery: deliveries.get(owner.threadId)!,
                    };

                    db.prepare('INSERT INTO brief_change_requests(request_id,work_id,content) VALUES(?,?,?)').run(
                        request.requestId,
                        shown.workId,
                        JSON.stringify(request),
                    );
                    db.prepare(
                        "UPDATE work_records SET status='Shaping',queue_order=NULL,needs_you=NULL,revision=revision+1,updated_at=? WHERE work_id=?",
                    ).run(request.at, shown.workId);

                    return request;
                });
            }),
        briefChangesDelivered: (id, requestId, outcome, error) =>
            database.write(() => {
                const request = list(id).find((entry) => entry.requestId === requestId);

                if (!request) throw new WorkRecordError('not-found', 'Change request not found.');

                const next = {
                    ...request.delivery,
                    sent: outcome === 'accepted',
                    error: outcome === 'accepted' ? null : (error ?? 'Delivery not confirmed.'),
                };

                if (outcome === 'rejected') {
                    next.commandId = randomUUID();
                    next.messageId = randomUUID();
                }

                const related = db
                    .prepare(
                        "SELECT work_id, content FROM brief_change_requests WHERE json_extract(content,'$.delivery.commandId')=?",
                    )
                    .all(request.delivery.commandId);

                for (const row of related) {
                    const entry = JSON.parse(String(row.content)) as BriefChangeRequest;

                    entry.delivery = { ...entry.delivery, ...next };
                    save(String(row.work_id), entry);
                }
            }),
    };
}
