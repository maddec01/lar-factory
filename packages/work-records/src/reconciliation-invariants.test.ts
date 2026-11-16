import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

test('legacy redundant edges are listed, cannot be dismissed, and record completion only after removal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-edge-'));
    const path = join(dir, 'records.db');
    const records = await openWorkRecords(path);

    try {
        const g = records.create({ title: 'Group', repository: 'fake/api', kind: 'concept' });
        const parts = [1, 2, 3].map((n) =>
            records.createPart({
                title: `Part ${n}`,
                repository: 'fake/api',
                parentId: g.workId,
                parentRevision: records.read(g.workId).revision,
                kind: 'build',
                body: `Files: \`src/${n}.ts\``,
                blockerIds: [],
            }),
        );
        const [a, b, c] = parts.map((p) => p.workId) as [string, string, string];

        records.addBlocker(b, records.read(b).revision, a);
        records.addBlocker(c, records.read(c).revision, b);

        // Simulate a graph saved by a version before redundant-edge rejection existed.
        const legacy = new DatabaseSync(path);

        legacy.prepare('INSERT INTO blockers(work_id,blocker_id) VALUES (?,?)').run(c, a);
        legacy.close();

        const item = records.reconcile(g.workId).items.find((i) => i.key === `redundant:${c}:${a}`)!;

        expect(item.requiresFix).toBe(true);
        expect(() => records.resolveReconcile(g.workId, item.key, item.digest, 'Ignore')).toThrow(/Fix the recorded/);
        records.removeBlocker(c, records.read(c).revision, a);

        const result = records.reconcile(g.workId);

        expect(result.items.some((i) => i.key === item.key)).toBe(false);
        expect(result.completed).toContainEqual(expect.objectContaining({ key: item.key, digest: item.digest }));
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
