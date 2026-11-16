import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vite-plus/test';

import { BUNDLE_URL, bundledSkillNames, readBundledSkills } from './bundled-skills.ts';

test('the assembled bundle installs only Lar skills with shared copies and nested checklists', () => {
    const root = fileURLToPath(BUNDLE_URL);

    assert.deepEqual(bundledSkillNames().sort(), ['lar-build', 'lar-shape']);

    const rows = readBundledSkills(root);

    assert.deepEqual(rows.map((row) => row.name).sort(), ['lar-build', 'lar-shape']);
    for (const row of rows) {
        assert.equal(row.author, 'Lar');
        assert.ok(row.includedAuthors?.length);
        assert.ok(row.notices?.endsWith('/THIRD_PARTY_NOTICES.md'));
        for (const file of readdirSync(new URL('../../../../skills/shared/', import.meta.url), {
            recursive: true,
            withFileTypes: true,
        }).filter((entry) => entry.isFile())) {
            const source = join(file.parentPath, file.name);
            const relative = source.split('/skills/shared/')[1]!;

            assert.deepEqual(readFileSync(join(root, 'skills', row.name, 'shared', relative)), readFileSync(source));
        }
    }
});
