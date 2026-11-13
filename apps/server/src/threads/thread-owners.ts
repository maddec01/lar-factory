import type { Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

import { createActivityDatabase } from '../t3/activity-database.ts';
import { factoryThreadNames } from '../t3/t3-db.ts';

const ID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const SHAPE = new RegExp(`(?:^|\\n)(?:[$/]lar-(?:shape|work) |Shape )(${ID})(?=[.\\s]|$)`, 'i');
const BUILD = new RegExp(`(?:^|\\n)Build (${ID})(?=[.\\s]|$)`, 'i');

/** A factory launch's explicit work ID, never an ID merely mentioned in its brief. */
function namedWork(text: string) {
    const shape = SHAPE.exec(text);
    const build = BUILD.exec(text);
    const first = shape && (!build || shape.index < build.index) ? shape : build;

    return first ? { workId: first[1]!.toLowerCase(), purpose: first === shape ? 'shape' : 'build' } : null;
}

/** Register direct factory handoffs just like resolved board launch intents. Repeated reads write nothing. */
function recordThreadOwners(
    records: WorkRecords,
    items: readonly Pick<Item, 'id'>[],
    rows: ReturnType<typeof factoryThreadNames>,
) {
    const allowed = new Set(items.map((item) => item.id));
    const known = records.threadsByWork();
    const pending = records.launchIntents({ unresolved: true });

    for (const { id, text, firstMessageAt } of rows) {
        if (typeof text !== 'string') continue;

        const owner = namedWork(text);

        if (!owner || !allowed.has(owner.workId) || known.get(owner.workId)?.some((t) => t.threadId === id)) continue;

        const record = records.read(owner.workId);

        const intent = pending.find(
            (intent) =>
                intent.workId === owner.workId &&
                intent.purpose === owner.purpose &&
                typeof firstMessageAt === 'string' &&
                Date.parse(firstMessageAt) >= Date.parse(intent.requestedAt),
        );

        // Board recovery must verify T3's model/options before settling its intent.
        // The unresolved intent already guards ownership; registering this thread early would
        // exclude it from that recovery lookup and bypass the execution check.
        if (
            intent &&
            records
                .runSettings(owner.workId)
                .roleRuns.some(
                    (run) => run.executionId === intent.intentId && run.role === 'thread' && run.result === 'running',
                )
        )
            continue;

        if (intent) {
            records.resolveLaunchIntent(owner.workId, record.revision, intent.intentId, { threadId: id });
            pending.splice(pending.indexOf(intent), 1);
        } else records.addThread(owner.workId, record.revision, id, owner.purpose);

        known.set(owner.workId, records.threads(owner.workId));
    }
}

/** T3 remains read-only and an outage cannot remove ownership already saved in local work records. */
export function createThreadOwnerDiscovery(path: string) {
    const database = createActivityDatabase(path);
    let cached:
        | { db: ReturnType<typeof database.open>; version: unknown; rows: ReturnType<typeof factoryThreadNames> }
        | undefined;
    const close = () => {
        cached = undefined;
        database.close();
    };
    const discover = (records: WorkRecords, items: readonly Pick<Item, 'id'>[]) => {
        if (!items.length) return;

        try {
            const db = database.open();
            const version = db.prepare('PRAGMA data_version').get()?.data_version;

            if (cached?.db !== db || cached.version !== version) cached = { db, version, rows: factoryThreadNames(db) };

            recordThreadOwners(records, items, cached.rows);
        } catch {
            close();
            // The next refresh retries; registered owners still guard Start while T3 is unavailable.
        }
    };

    return Object.assign(discover, { close });
}
