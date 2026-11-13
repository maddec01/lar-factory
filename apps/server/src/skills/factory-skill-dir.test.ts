import { buildMessage, workMessage, type Item } from '@lar-factory/shared';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vite-plus/test';

import { BUNDLE_URL } from './bundled-skills.ts';
import { factorySkillDir } from './factory-skill-dir.ts';

test('development launch prompts name the checkout bundle and preserve the isolated CLI and data handoff', () => {
    const bundle = fileURLToPath(BUNDLE_URL);
    const env = { NODE_ENV: 'development', BOARD_DEV_SKILLS_DIR: bundle };
    const context = {
        shapeSkill: join(factorySkillDir('lar-shape', env), 'SKILL.md'),
        bin: '/isolated/run/install/.local/bin',
        dataDir: '/isolated/run/data',
        delegationModel: {
            instanceId: 'codex',
            model: 'gpt-6-astra',
            options: [{ id: 'reasoningEffort', value: 'high' }],
        },
    };
    const item = { id: 'work-id', title: 'Smoke', number: null } as unknown as Item;
    const shape = workMessage(item, context);
    const build = buildMessage(item, factorySkillDir('lar-build', env), context);

    expect(shape).toContain(`Read '${join(bundle, 'lar-shape/SKILL.md')}'`);
    expect(build).toContain(`Read ${join(bundle, 'lar-build/agents/builder.md')}`);
    for (const message of [shape, build]) {
        expect(message).toContain("export LAR_FACTORY_DATA_DIR='/isolated/run/data'");
        expect(message).toContain('export PATH=\'/isolated/run/install/.local/bin\':"$PATH"');
        expect(message).toContain("Use '/isolated/run/install/.local/bin/lar-work'");
        expect(message).toContain('Pass these exact paths and environment to every delegated task.');
        expect(message).not.toContain('/.agents/skills/');
        expect(message).toContain(
            '"providerInstanceId":"codex","model":"gpt-6-astra","options":{"reasoningEffort":"high"}',
        );
    }
});

test('an unset override keeps the installed skills', () => {
    expect(factorySkillDir('lar-shape', { LAR_FACTORY_INSTALL_ROOT: '/installation' })).toBe(
        '/installation/.agents/skills/lar-shape',
    );
});

test('invalid or unavailable development bundles refuse instead of selecting installed skills', () => {
    for (const env of [
        { NODE_ENV: 'production', BOARD_DEV_SKILLS_DIR: '/checkout/.assembled-skills' },
        { NODE_ENV: 'development', BOARD_DEV_SKILLS_DIR: 'relative' },
        { NODE_ENV: 'development', BOARD_DEV_SKILLS_DIR: '' },
        { NODE_ENV: 'development', BOARD_DEV_SKILLS_DIR: '/missing-f04-checkout/.assembled-skills' },
    ])
        expect(() => factorySkillDir('lar-shape', env)).toThrow(/BOARD_DEV_SKILLS_DIR|ENOENT/);
});
