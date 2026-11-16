import { workMessage, type Item } from '@lar-factory/shared';
import { mkdtempSync, rmSync } from 'node:fs';
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

        const before = records.read(d.workId);

        expect(() => records.setBody(d.workId, before.revision, 'answer', `Use UTC.\n\n${handoff}`)).toThrow(
            /product content.*run.settings/i,
        );
        expect(records.read(d.workId)).toEqual(before);

        const saved =
            "Method: task\nDocument how product users configure their own run settings and PATH.\nTest with export LAR_FACTORY_DATA_DIR='/tmp/test'.\nexport LAR_FACTORY_DATA_DIR='/tmp/test'";

        records.setBody(d.workId, d.revision, 'decision', saved);
        expect(records.body(d.workId, 'decision')).toBe(saved);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
