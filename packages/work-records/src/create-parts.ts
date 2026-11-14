import { effectiveIssueSettings } from '@lar-factory/shared';
import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { randomUUID } from 'node:crypto';

import { blockerDeclarations } from './blocker-declarations.ts';
import { WorkRecordError, type Database } from './database.ts';
import { saveProjection } from './group-projections.ts';
import { expectRevision } from './record-revision.ts';
import type { WorkRecord, WorkRecords } from './work-records.ts';

export interface PartBatch {
    map: string;
    parts: {
        key: string;
        repository: string;
        title: string;
        kind: 'build' | 'decision';
        body: string;
        blockerIds: string[];
        ticketRequestId?: string;
    }[];
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};

/** All local work, ticket requests and graph declarations become visible at the same commit. */
export function partBatchRecords(database: Database, get: () => WorkRecords, dataDir: string) {
    return {
        createParts: (id: string, revision: number, input: PartBatch) =>
            database.write(() => {
                const records = get();
                const parent = records.read(id);

                expectRevision(parent, revision);

                if (
                    !input ||
                    typeof input.map !== 'string' ||
                    !input.map.trim() ||
                    !Array.isArray(input.parts) ||
                    !input.parts.length ||
                    input.parts.length > 100
                )
                    invalid('Supply a map and 1–100 complete parts.');

                const setups = readRepositorySetups(dataDir);

                input = {
                    ...input,
                    parts: input.parts.map((part) => {
                        const setup = setups.find((s) => s.repo === part?.repository);

                        return part?.kind === 'build' &&
                            !part.ticketRequestId &&
                            setup &&
                            effectiveIssueSettings(setup).createIssuesFromAddItem
                            ? { ...part, ticketRequestId: randomUUID() }
                            : part;
                    }),
                };

                const keys = new Set<string>();

                for (const p of input.parts) {
                    if (!p || typeof p.key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(p.key) || keys.has(p.key))
                        invalid('Part keys must be distinct simple names.');

                    keys.add(p.key);

                    if (!Array.isArray(p.blockerIds) || p.blockerIds.some((b) => typeof b !== 'string' || !b))
                        invalid('Supply each part’s blockers.');

                    if (p.ticketRequestId && (p.kind !== 'build' || !/^[a-f0-9-]{36}$/.test(p.ticketRequestId)))
                        invalid('A build ticket needs a UUID request ID.');
                }

                const created = new Map<string, WorkRecord>();

                // Allocate IDs before resolving edges, allowing forward references inside the batch.
                for (const p of input.parts)
                    created.set(
                        p.key,
                        records.createPart({
                            ...p,
                            parentId: id,
                            parentRevision: records.read(id).revision,
                            blockerIds: [],
                        }),
                    );

                const resolve = (ref: string) =>
                    ref.startsWith('$')
                        ? (created.get(ref.slice(1))?.workId ?? invalid(`Unknown part reference ${ref}.`))
                        : ref;
                const render = (text: string) =>
                    text.replace(
                        /\$\{([a-zA-Z0-9_-]+)\}/g,
                        (_, key: string) => created.get(key)?.workId ?? invalid(`Unknown part reference ${key}.`),
                    );

                for (const p of input.parts) {
                    const record = created.get(p.key)!;
                    const blockers = p.blockerIds.map(resolve);
                    const body = render(p.body);
                    // The brief is authoritative; reject a second, conflicting graph in the manifest.
                    const declared = /^(?:\s*-\s*)?Blocked by:/im.test(body);

                    records.setBody(
                        record.workId,
                        records.read(record.workId).revision,
                        p.kind === 'build' ? 'brief' : 'decision',
                        !declared
                            ? `${body}\n\nBlocked by: ${blockers.length ? blockers.map((b) => `\`${records.read(b).title}\``).join(', ') : 'none'}`
                            : body,
                    );

                    records.update(record.workId, records.read(record.workId).revision, { status: 'Queued' });

                    if (p.ticketRequestId)
                        database.db
                            .prepare('INSERT INTO part_ticket_requests(work_id,request_id) VALUES (?,?)')
                            .run(record.workId, p.ticketRequestId);
                }

                records.setBody(id, records.read(id).revision, 'map', render(input.map));

                const declarations = blockerDeclarations(records, id);

                for (const p of input.parts) {
                    const record = created.get(p.key)!;
                    const wanted = p.blockerIds.map(resolve).sort();

                    if (JSON.stringify(declarations.get(record.workId)) !== JSON.stringify(wanted))
                        invalid(`Brief/map blockers disagree with ${p.key}'s blockerIds.`);
                }

                const revisions = Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision]));

                records.syncBlockers(id, revisions);
                saveProjection(database, records, id, 'map');

                return {
                    parts: [...created.values()].map((r) => records.read(r.workId)),
                    keys: Object.fromEntries([...created].map(([key, r]) => [key, r.workId])),
                };
            }),
        partTicketRequests: (id: string) =>
            database.read(() =>
                database.db
                    .prepare(
                        'SELECT q.work_id,q.request_id,r.ticket FROM part_ticket_requests q JOIN work_records r ON r.work_id=q.work_id WHERE r.parent_id=? ORDER BY q.rowid',
                    )
                    .all(id)
                    .map((row) => ({
                        workId: String(row.work_id),
                        requestId: String(row.request_id),
                        ticket: row.ticket as string | null,
                    })),
            ),
    };
}
