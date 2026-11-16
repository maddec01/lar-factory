import { expect, test } from 'vite-plus/test';

import { factorySkillDir } from './factory-skill-dir.ts';

test('invalid or unavailable development bundles refuse instead of selecting installed skills', () => {
    for (const env of [
        { NODE_ENV: 'production', BOARD_DEV_SKILLS_DIR: '/checkout/.assembled-skills' },
        { NODE_ENV: 'development', BOARD_DEV_SKILLS_DIR: '/missing-f04-checkout/.assembled-skills' },
    ])
        expect(() => factorySkillDir('lar-shape', env)).toThrow(/BOARD_DEV_SKILLS_DIR|ENOENT/);
});
