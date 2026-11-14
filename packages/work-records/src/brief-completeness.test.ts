import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

const feature =
    '## Done when\n- Names survive trimming.\n### Tests\n- `test/name.test.js`: preserves one-character names and rejects empty names.\n## Scope\n### Files\n- `name.js`\n';
const diagnosis =
    '## Cause\nThe length guard requires two characters.\n## Evidence\nparseName("A") returned friend in the reproduction.\n## Regression test\n`test/name.test.js`: keeps one-character names.\n## Red-before-green\nRun the named test against the old guard, observe failure, then fix it and rerun.\n';

test('gate presentation refuses each missing Bug obligation, including empty sections, before any approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brief-completeness-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        let work = records.create({ title: 'Short names', repository: 'fake/app', kind: 'bug' });

        for (const [heading, label] of [
            ['Cause', 'cause'],
            ['Evidence', 'evidence'],
            ['Regression test', 'named regression test'],
            ['Red-before-green', 'red-before-green'],
        ] as const) {
            const brief = feature + diagnosis.replace(new RegExp(`## ${heading}\\n[^#]*`), `## ${heading}\n`);

            work = records.setBody(work.workId, work.revision, 'brief', brief);
            expect(() => records.displayGate(work.workId)).toThrow(label);
            expect(() => records.gateBatch([work.workId])).toThrow(label);
            expect(records.gate(work.workId).evidence).toEqual([]);
        }
        work = records.setBody(work.workId, work.revision, 'brief', feature + diagnosis);
        expect(records.displayGate(work.workId).brief).toBe(feature + diagnosis);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

for (const kind of ['feature', 'improvement'] as const)
    test(`${kind} gate names all missing acceptance, files and tests`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'brief-completeness-'));
        const records = await openWorkRecords(join(dir, 'work.db'));

        try {
            let work = records.create({ title: 'Names', repository: 'fake/app', kind });

            work = records.setBody(
                work.workId,
                work.revision,
                'brief',
                '## What\nKeep names.\n## Done when\nTODO\n### Tests\nnone\n## Scope\n### Files\nTBD',
            );
            expect(() => records.displayGate(work.workId)).toThrow(/acceptance.*affected files.*named tests/);
            work = records.setBody(work.workId, work.revision, 'brief', feature);
            expect(records.displayGate(work.workId).brief).toBe(feature);
        } finally {
            records.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

test('every linked batch member is checked again while unrelated sibling progress preserves Doubt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'linked-completeness-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const parent = records.create({ title: 'Linked names', repository: 'fake/app', kind: 'build' });
        const ids = [0, 1].map(
            (index) =>
                records.createPart({
                    parentId: parent.workId,
                    parentRevision: records.read(parent.workId).revision,
                    title: `Names ${index}`,
                    repository: 'fake/app',
                    kind: 'build',
                    body: (feature + diagnosis).replaceAll('name.js', `name-${index}.js`),
                    blockerIds: [],
                }).workId,
        );

        for (const id of ids) {
            const input = records.doubtPackage(id);

            records.recordDoubt(id, input.packageDigest, 'Doubt', 'Reviewed code and named regression.', []);
        }

        const before = records.doubtPackage(ids[0]!).packageDigest;

        records.update(ids[1]!, records.read(ids[1]!).revision, { status: 'Shaping' });
        expect(records.doubtPackage(ids[0]!).packageDigest).toBe(before);
        expect(records.gateBatch(ids).members).toHaveLength(2);

        const missing = feature.replace(/### Tests\n[^#]*/, '### Tests\n');

        records.setBody(ids[1]!, records.read(ids[1]!).revision, 'brief', missing);
        expect(() => records.gateBatch(ids)).toThrow('named tests');
        expect(() => records.displayGate(parent.workId)).toThrow('linked parent has no delivery gate');
        for (const id of ids) expect(records.gate(id).evidence).toEqual([]);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
