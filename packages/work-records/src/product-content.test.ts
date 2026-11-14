import { workMessage, type Item } from '@lar-factory/shared';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

const handoff = workMessage({ id: 'fake', title: 'Choose timezone', number: 0, kind: 'decision' } as Item, {
    dataDir: '/fake/data',
    bin: '/fake/bin',
    shapeSkill: '/fake/shape/SKILL.md',
    buildSkill: '/fake/build/SKILL.md',
});

test('record writes refuse launch environment and frozen settings without changing product records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'product-content-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const g = records.create({ title: 'Display time', repository: 'fake/api', kind: 'concept' });
        const d = records.createPart({
            title: 'Timezone',
            repository: 'fake/api',
            kind: 'decision',
            parentId: g.workId,
            parentRevision: g.revision,
            body: 'Method: grill\nUTC or local?',
            blockerIds: [],
        });

        for (const body of ['decision', 'answer', 'domain-drafts'] as const) {
            const before = records.read(d.workId);

            expect(() => records.setBody(d.workId, before.revision, body, `Use UTC.\n\n${handoff}`)).toThrow(
                /product content.*run.settings/i,
            );
            expect(records.read(d.workId)).toEqual(before);
        }
        for (const kind of ['build', 'decision'] as const) {
            const before = records.read(g.workId);

            expect(() =>
                records.createPart({
                    title: 'Contaminated',
                    repository: 'fake/api',
                    kind,
                    parentId: g.workId,
                    parentRevision: before.revision,
                    body: handoff,
                    blockerIds: [],
                }),
            ).toThrow(/product content/i);
            expect(records.read(g.workId)).toEqual(before);
            expect(records.children(g.workId)).toHaveLength(1);
        }
        expect(() =>
            records.setBody(
                d.workId,
                d.revision,
                'answer',
                'Use UTC.\nRun settings (pass this exact block and the factory environment to every child and handoff): {}',
            ),
        ).toThrow(/product content/i);

        const legacy = handoff.replace(/<!-- factory-runtime:(?:start|end) -->/g, '');

        expect(() => records.setBody(d.workId, d.revision, 'decision', legacy)).toThrow(/product content/i);
        expect(() => records.setBody(g.workId, records.read(g.workId).revision, 'map', legacy)).toThrow(
            /product content/i,
        );
        expect(records.mapHistory(g.workId)).toEqual([]);

        const file = join(dir, 'decision.md');

        writeFileSync(file, `Method: grill\nUTC or local?\n${legacy}`);

        const beforeCLI = records.read(d.workId);

        expect(() =>
            execFileSync(
                process.execPath,
                [
                    join(import.meta.dirname, 'cli.ts'),
                    'set-body',
                    d.workId,
                    '--revision',
                    String(beforeCLI.revision),
                    '--body',
                    'decision',
                    '--file',
                    file,
                    '--data-dir',
                    dir,
                ],
                { stdio: 'pipe' },
            ),
        ).toThrow(/product content/i);
        expect(records.read(d.workId)).toEqual(beforeCLI);
        expect(records.body(d.workId, 'decision')).toBe('Method: grill\nUTC or local?');

        const build = records.create({ title: 'Display UTC', repository: 'fake/api', kind: 'build' });
        const state = records.specState(build.workId);

        expect(() =>
            records.saveSpecState(build.workId, state.generation, state, {
                text: legacy,
                source: 'tracker',
                identity: 'Fixture',
                evidence: 'Copied text',
            }),
        ).toThrow(/product content/i);
        expect(records.specState(build.workId)).toEqual(state);
        expect(records.body(build.workId, 'brief')).toBeNull();

        const snapshot = records.trackerSnapshot(g.workId);

        snapshot.nodes.find((n) => n.kind === 'concept')!.map = legacy;

        const fresh = await openWorkRecords(join(dir, 'fresh.db'));

        try {
            expect(() => fresh.trackerRestore(snapshot, 'fixture')).toThrow(/product content/i);
            expect(fresh.list({})).toEqual([]);
        } finally {
            fresh.close();
        }

        const saved =
            "Method: task\nDocument how product users configure their own run settings and PATH.\nTest with export LAR_FACTORY_DATA_DIR='/tmp/test'.\nexport LAR_FACTORY_DATA_DIR='/tmp/test'";

        records.setBody(d.workId, d.revision, 'decision', saved);
        expect(records.body(d.workId, 'decision')).toBe(saved);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
