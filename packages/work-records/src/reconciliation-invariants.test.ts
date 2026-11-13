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

        const revision = records.read(g.workId).revision;

        expect(() =>
            setSteps(records, g.workId, revision, [
                { id: 'pair', title: 'Ship', kind: 'ships-with', workIds: [a], evidence: null },
            ]),
        ).toThrow(/two active delivery members/);
        expect(records.read(g.workId).revision).toBe(revision);
        expect(records.releaseSteps(g.workId)).toEqual([]);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a proposed-build merge reopens the survivor and the map without losing the absorbed record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-merge-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    try {
        const g = records.create({ title: 'Group', repository: 'fake/api', kind: 'concept' });
        const parts = [1, 2].map((n) =>
            records.createPart({
                title: `Part ${n}`,
                repository: 'fake/api',
                parentId: g.workId,
                parentRevision: records.read(g.workId).revision,
                kind: 'build',
                body: `Acceptance ${n}`,
                blockerIds: [],
            }),
        );
        const [a, b] = parts.map((p) => p.workId) as [string, string];

        records.mergeBuild(a, records.read(a).revision, {
            into: b,
            revisions: {
                [g.workId]: records.read(g.workId).revision,
                [a]: records.read(a).revision,
                [b]: records.read(b).revision,
            },
        });
        expect(records.read(a).supersededBy).toBe(b);
        expect(records.body(b, 'brief')).toContain('Acceptance 1');

        const report = records.reconcile(g.workId);

        expect(report.items).toContainEqual(expect.objectContaining({ key: `doubt:${b}` }));
        expect(report.items).toContainEqual(
            expect.objectContaining({ key: `map:${a}`, after: expect.objectContaining({ supersededBy: b }) }),
        );
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

function setSteps(
    records: import('./work-records.ts').WorkRecords,
    id: string,
    revision: number,
    steps: import('@lar-factory/shared/group-reconciliation').ReleaseStep[],
) {
    records.setReleasePlan(id, revision, {
        steps: steps.map((s) => ({
            id: s.id,
            who: 'Fixture release owner',
            what: s.title,
            ...(s.kind === 'ships-with' ? { shipsWith: s.workIds } : {}),
        })),
        outcomeCheck: 'Every app reconnects and invitation links work.',
    });
    for (const step of steps)
        if (step.evidence)
            records.completeReleaseStep(id, records.read(id).revision, step.id, 'Fixture release owner', step.evidence);

    return records.releaseSteps(id);
}
