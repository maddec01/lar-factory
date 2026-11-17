import { createHash } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import type { GateManifest } from './gate-batch.ts';
import type { PrLoopState } from './pr-loop.ts';
import type { WorkRecords } from './work-records.ts';

type Amendment = NonNullable<PrLoopState['amendment']>;
export interface PrAmendmentDisplay {
    ownerId: string;
    authorization: Amendment;
    records: unknown[];
    gates: GateManifest;
    digest: string;
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};

/** One producer owns the hold and receipt for the whole correction, including unstarted consumers. */
export function linkedPrAmendmentRecords(database: Database, records: () => WorkRecords) {
    const { db } = database;
    const root = (id: string): string => {
        const record = records().read(id);

        return record.parentId ? root(record.parentId) : id;
    };
    const active = (id: string) => {
        for (const row of db
            .prepare("SELECT work_id,content FROM pr_loop WHERE json_extract(content, '$.amendment') IS NOT NULL")
            .all()) {
            const ownerId = String(row.work_id);
            const state = JSON.parse(String(row.content)) as PrLoopState;
            const owner = records().read(ownerId);

            if (
                state.amendment &&
                state.pr === owner.pullRequest &&
                !owner.finishedAt &&
                !owner.setAside &&
                (state.amendment.workIds ?? [ownerId]).includes(id)
            )
                return { ownerId, ...state.amendment };
        }

        return null;
    };
    const display = (ownerId: string): PrAmendmentDisplay => {
        const authorization = records().prLoop(ownerId).amendment;

        if (!authorization?.workIds) return invalid('Begin the linked PR amendment before displaying it.');

        const ids = authorization.workIds;
        const snapshots = ids.map((id) => {
            const record = records().read(id);

            if (active(id)?.ownerId !== ownerId || root(id) !== root(ownerId) || record.setAside || record.finishedAt)
                invalid('The linked amendment changed. Read its affected work again.');

            return {
                workId: id,
                title: record.title,
                repository: record.repository,
                kind: record.kind,
                parentId: record.parentId,
                bodies: db.prepare('SELECT body,markdown FROM bodies WHERE work_id=? ORDER BY body').all(id),
                scope: records().confirmedScope(id)?.scope ?? null,
                releasePlan: records().releasePlan(id),
            };
        });
        const builds = ids.filter(
            (id) =>
                !records()
                    .children(id)
                    .some((child) => child.kind !== 'slice'),
        );
        const content = { ownerId, authorization, records: snapshots, gates: records().gateBatch(builds) };

        return { ...content, digest: hash(content) };
    };

    return {
        activePrAmendment: (id: string) => database.read(() => active(id)),
        beginLinkedPrAmendment: (ownerId: string, amendment: Amendment, affected: string[]) =>
            database.write(() => {
                const existing = records().prLoop(ownerId).amendment?.workIds ?? [];
                const ids = [...new Set([ownerId, ...existing, ...affected, root(ownerId)])].sort();

                for (const id of ids) {
                    const record = records().read(id);

                    if (
                        root(id) !== root(ownerId) ||
                        record.setAside ||
                        record.finishedAt ||
                        ['slice', 'decision'].includes(record.kind)
                    )
                        invalid('Only active linked builds and their parent can share this amendment.');

                    if (active(id) && active(id)!.ownerId !== ownerId)
                        invalid('Another owner is already amending this linked work.');

                    if (
                        !records()
                            .children(id)
                            .some((child) => child.kind !== 'slice') &&
                        !records()
                            .gate(id)
                            .evidence.some((gate) => gate.source === 'gate' || gate.source === 'user')
                    )
                        invalid('Linked amendments require originally approved builds.');
                }

                const state = records().prLoop(ownerId);

                state.amendment = { ...amendment, workIds: ids };
                records().savePrLoop(ownerId, state);

                return state.amendment;
            }),
        displayPrAmendment: (ownerId: string) => database.write(() => display(ownerId)),
        recordLinkedPrAmendment: (shown: PrAmendmentDisplay, digest: string, by: string, evidence: string) =>
            database.write(() => {
                const { digest: displayedDigest, ...content } = shown;

                if (displayedDigest !== digest || hash(content) !== digest)
                    invalid('The displayed amendment digest changed. Display it again.');

                const current = display(shown.ownerId);

                if (
                    JSON.stringify(current.gates.members.map((member) => member.display.workId)) !==
                    JSON.stringify(shown.gates.members.map((member) => member.display.workId))
                )
                    invalid('Approve every affected delivery gate together.');

                // Gate batches already tolerate lifecycle-only revisions under their write lock.
                const { gates: _gates, digest: _digest, ...currentContent } = current;
                const { gates: _shownGates, ...shownContent } = content;

                if (hash(currentContent) !== hash(shownContent) || shown.authorization.evidence !== evidence)
                    invalid('The linked product content or authorizing comment changed. Display it again.');

                const receipt = records().recordGateBatch(
                    shown.gates,
                    shown.gates.digest,
                    by,
                    `${evidence}\nLinked amendment ${digest}: ${JSON.stringify(shown)}`,
                );
                const state = records().prLoop(shown.ownerId);

                delete state.amendment;
                records().savePrLoop(shown.ownerId, state);

                return receipt;
            }),
    };
}
