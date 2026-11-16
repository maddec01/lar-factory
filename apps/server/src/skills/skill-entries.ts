// Where a run's threads read lar-shape and lar-build: the release folder the run started on, so an app update mid-run
// never changes its instructions, or the checkout's assembled skills when no packaged app runs the board.
import { isRelease } from '@lar-factory/shared/run-settings';
import { accessSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLE_URL } from './bundled-skills.ts';
import { runningRelease } from './release-folders.ts';

/** The SKILL.md entries a thread reads. */
export interface SkillEntries {
    shapeSkill: string;
    buildSkill: string;
}

const entriesIn = (skills: string): SkillEntries => ({
    shapeSkill: join(skills, 'lar-shape/SKILL.md'),
    buildSkill: join(skills, 'lar-build/SKILL.md'),
});

/** An explicit development bundle, else the checkout's assembled skills. An invalid override never falls back. */
function developmentSkills(env: NodeJS.ProcessEnv): string {
    const bundle = env.BOARD_DEV_SKILLS_DIR;

    if (bundle === undefined) return fileURLToPath(new URL('skills/', BUNDLE_URL));

    if (env.NODE_ENV !== 'development' || !isAbsolute(bundle))
        throw new Error('BOARD_DEV_SKILLS_DIR requires NODE_ENV=development and an absolute assembled skill folder.');

    accessSync(join(bundle, 'lar-shape/SKILL.md'));
    accessSync(join(bundle, 'lar-build/agents/builder.md'));

    return bundle;
}

/**
 * The skill entries of a run that froze `release`. With a packaged app: that release's folder in `dataDir` when it
 * exists, else the running release's, else the app's own bundle (BOARD_BUNDLE_DIR); a missing release never refuses.
 * Without one: the development skills for every run, whatever release it froze.
 */
export function skillEntries(
    release: string | undefined,
    dataDir: string,
    env: NodeJS.ProcessEnv = process.env,
): SkillEntries {
    const running = runningRelease(env);

    if (!running) return entriesIn(developmentSkills(env));

    for (const candidate of [release, running]) {
        if (!isRelease(candidate)) continue;

        const entries = entriesIn(join(dataDir, 'bundles', candidate, 'skills'));

        if (existsSync(entries.shapeSkill) && existsSync(entries.buildSkill)) return entries;
    }

    return entriesIn(join(env.BOARD_BUNDLE_DIR ?? join(dataDir, 'bundles', running), 'skills'));
}
