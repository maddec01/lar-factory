import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import type { NewPart } from './create-part.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'create-part-'));

    dirs.push(dir);

    const path = join(dir, 'work-records.db');
    const records = await openWorkRecords(path);

    opened.push(records);

    const parent = records.create({ title: 'Destination', repository: 'example/plan', kind: 'concept' });
    const blocker = records.create({ title: 'Contract', repository: 'example/api', kind: 'build' });
    const input: NewPart = {
        parentId: parent.workId,
        parentRevision: parent.revision,
        repository: 'example/client',
        title: 'Use the contract',
        kind: 'build',
        body: '## What to build\n\nUse the contract.\n',
        blockerIds: [blocker.workId],
    };

    return { records, path, parent, blocker, input };
}

describe('createPart', () => {
    it('creates a build with its full state in either repository', async () => {
        const { records, parent, blocker, input } = await fixture();

        for (const repository of [parent.repository, input.repository]) {
            const record = records.createPart({
                ...input,
                repository,
                parentRevision: records.read(parent.workId).revision,
            });

            expect(record).toMatchObject({
                repository,
                parentId: parent.workId,
                kind: 'build',
                title: input.title,
                status: 'Queued',
                queueOrder: 1,
                revision: 1,
                ticket: null,
            });
            expect(records.body(record.workId, 'brief')).toBe(input.body);
            expect(records.blockers(record.workId).map((item) => item.workId)).toEqual([blocker.workId]);
            expect(records.read(record.workId)).toEqual(record);

            expect(records.gate(record.workId).current).toBe(false);
            expect(() => records.recordLaunchIntent(record.workId, record.revision, 'build')).toThrow(
                /current passing gate/,
            );
        }
        expect(records.read(parent.workId).revision).toBe(3);
        expect(records.read(blocker.workId).revision).toBe(3);
        expect(records.read(blocker.workId).status).toBe('List');
    });

    it.each([
        ['stale parent', { parentRevision: 2 }, 'stale-revision'],
        ['missing final blocker', { blockerIds: ['missing'] }, 'not-found'],
    ] as const)('leaves no orphan or changed relationships on %s', async (_name, patch, code) => {
        const { records, parent, blocker, input } = await fixture();
        const before = records.list({});
        const changed = { ...input, ...patch } as NewPart;

        if ('blockerIds' in patch) changed.blockerIds = [blocker.workId, ...patch.blockerIds];

        expect(() => records.createPart(changed)).toThrow(expect.objectContaining({ code }));
        expect(records.list({})).toEqual(before);
        expect(records.children(parent.workId)).toEqual([]);
        expect(records.dependents(blocker.workId)).toEqual([]);
        // A rolled-back insertion must not consume a queue position.
        expect(records.createPart(input).queueOrder).toBe(1);
    });

    it('rolls back body, edges and all revisions when a final relationship write fails', async () => {
        const { records, path, parent, blocker, input } = await fixture();
        const db = new DatabaseSync(path);

        try {
            db.exec(`CREATE TRIGGER refuse_relationship BEFORE UPDATE OF revision ON work_records
                WHEN OLD.title = 'Contract' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;`);

            const before = records.list({});

            expect(() => records.createPart(input)).toThrow('injected write failure');
            expect(records.list({})).toEqual(before);
            expect(records.children(parent.workId)).toEqual([]);
            expect(records.dependents(blocker.workId)).toEqual([]);
            expect(db.prepare('SELECT count(*) AS count FROM bodies').get()?.count).toBe(0);
            expect(db.prepare('SELECT count(*) AS count FROM blockers').get()?.count).toBe(0);
        } finally {
            db.close();
        }
    });
});
