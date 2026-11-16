import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { skillEntries } from './skill-entries.ts';

test('invalid or unavailable development bundles refuse instead of selecting other skills', () => {
    for (const env of [
        { NODE_ENV: 'production', BOARD_DEV_SKILLS_DIR: '/checkout/.assembled-skills' },
        { NODE_ENV: 'development', BOARD_DEV_SKILLS_DIR: '/missing-f04-checkout/.assembled-skills' },
    ])
        expect(() => skillEntries(undefined, '/data', env)).toThrow(/BOARD_DEV_SKILLS_DIR|ENOENT/);
});

test("a packaged app whose release folders are all missing reads the app's own bundle", () => {
    expect(
        skillEntries('1.0.0', '/missing-data', { BOARD_APP_VERSION: '2.0.0', BOARD_BUNDLE_DIR: '/app/bundle' }),
    ).toEqual({
        shapeSkill: '/app/bundle/skills/lar-shape/SKILL.md',
        buildSkill: '/app/bundle/skills/lar-build/SKILL.md',
    });
});

test('a stored release that is not a folder name falls back to the running release', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'lar-skill-entries-'));

    try {
        // Skills where `..` and `a/b` would resolve, so only the release check keeps them out.
        for (const skills of [join(dataDir, 'skills'), join(dataDir, 'bundles', 'a', 'b', 'skills')])
            for (const skill of ['lar-shape', 'lar-build']) {
                mkdirSync(join(skills, skill), { recursive: true });
                writeFileSync(join(skills, skill, 'SKILL.md'), skill);
            }

        const running = join(dataDir, 'bundles', '2.0.0', 'skills');

        for (const skill of ['lar-shape', 'lar-build']) {
            mkdirSync(join(running, skill), { recursive: true });
            writeFileSync(join(running, skill, 'SKILL.md'), skill);
        }

        for (const release of ['..', 'a/b'])
            expect(skillEntries(release, dataDir, { BOARD_APP_VERSION: '2.0.0' })).toEqual({
                shapeSkill: join(running, 'lar-shape/SKILL.md'),
                buildSkill: join(running, 'lar-build/SKILL.md'),
            });
    } finally {
        rmSync(dataDir, { recursive: true, force: true });
    }
});
