import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

test('linked work reviews its parent scope and ships-with pair without treating the parent as another file owner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-linked-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    try {
        const g = records.create({ title: 'Linked reconnect work', repository: 'fake/api', kind: 'feature' });

        records.setBody(g.workId, g.revision, 'brief', 'Files: `src/server.ts`\nConnect all apps.');

        const parts = [1, 2].map((n) =>
            records.createPart({
                title: `Part ${n}`,
                repository: n === 1 ? 'fake/api' : 'fake/app',
                parentId: g.workId,
                parentRevision: records.read(g.workId).revision,
                kind: 'build',
                body: n === 1 ? 'Files: `src/server.ts`' : 'Files: `src/client.ts`',
                blockerIds: [],
            }),
        );
        const a = parts[0]!.workId;
        const pkg = records.doubtPackage(a);

        expect(pkg.overlaps).toEqual([]);
        expect(pkg.siblings.some((s) => s.workId === g.workId)).toBe(true);
        records.recordDoubt(a, pkg.packageDigest, 'Doubt', 'Scope and contracts agree.', []);
        setSteps(records, g.workId, records.read(g.workId).revision, [
            {
                id: 'release',
                title: 'Ship API and app together',
                kind: 'ships-with',
                workIds: parts.map((p) => p.workId),
                evidence: null,
            },
        ]);
        expect(records.currentDoubt(a)).toBeNull();
        expect(records.reconcile(g.workId).items.some((i) => i.kind === 'release')).toBe(true);

        const reviewed = records.doubtPackage(a);

        records.recordDoubt(a, reviewed.packageDigest, 'Doubt', 'Release contract reviewed.', []);
        records.setBody(
            g.workId,
            records.read(g.workId).revision,
            'brief',
            'Files: `src/server.ts`\nConnect all apps through /replacement.',
        );
        expect(records.currentDoubt(a)).toBeNull();
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

test('release order, owners and a step named outcome remain distinct checklist sources', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-release-order-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    try {
        const g = records.create({ title: 'Release group', repository: 'fake/api', kind: 'concept' });
        const steps = [
            { id: 'outcome', who: 'Hosting', what: 'Activate DNS' },
            { id: 'portal', who: 'Apps', what: 'Activate portal' },
        ];

        records.setReleasePlan(g.workId, g.revision, { steps, outcomeCheck: 'Links open the app.' });
        expect(records.reconcile(g.workId).items.map((item) => item.key)).toEqual(
            expect.arrayContaining(['release:outcome', `release-outcome:${g.workId}`]),
        );
        for (const item of records.reconcile(g.workId).items)
            records.resolveReconcile(g.workId, item.key, item.digest, 'Initial plan recorded.');
        records.setReleasePlan(g.workId, records.read(g.workId).revision, {
            steps: [steps[1], { ...steps[0], who: 'Operations' }],
            outcomeCheck: 'Links open the app.',
        });
        expect(records.reconcile(g.workId).items).toContainEqual(
            expect.objectContaining({ key: 'release:outcome', changes: expect.arrayContaining(['order', 'who']) }),
        );
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
