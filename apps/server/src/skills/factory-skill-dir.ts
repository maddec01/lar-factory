// Development runs can launch directly from a checkout's assembled skills without replacing an installed skill.
import { accessSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { installHome } from './bundled-skills.ts';

/** An explicit development bundle, or the normal installation. An invalid override never falls back. */
export function factorySkillDir(name: 'lar-shape' | 'lar-build', env: NodeJS.ProcessEnv = process.env): string {
    const bundle = env.BOARD_DEV_SKILLS_DIR;

    if (bundle === undefined) return join(installHome(env), '.agents/skills', name);

    if (env.NODE_ENV !== 'development' || !isAbsolute(bundle))
        throw new Error('BOARD_DEV_SKILLS_DIR requires NODE_ENV=development and an absolute assembled skill folder.');

    const directory = join(bundle, name);

    accessSync(join(directory, 'SKILL.md'));
    accessSync(join(bundle, 'lar-build/agents/builder.md'));

    return directory;
}
