import {
    BUILTIN_REVIEWERS,
    type FactoryModelGroup,
    type FactorySettingsState,
} from '@lar-factory/shared/factory-settings';
import { readFactorySettings, writeFactorySettings } from '@lar-factory/work-records/factory-settings';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLE_URL } from '../skills/bundled-skills.ts';

const revision = (settings: unknown) => createHash('sha256').update(JSON.stringify(settings)).digest('hex');

/** Local data only. Built-in paths are fixed, never supplied by the browser. */
export function factorySettingsService(
    dir?: string,
    bundle = process.env.BOARD_BUNDLE_DIR ?? fileURLToPath(BUNDLE_URL),
) {
    const defaults = () =>
        Object.fromEntries(
            BUILTIN_REVIEWERS.map((id) => [
                id,
                readFileSync(join(bundle, 'lar-build', 'agents', `reviewer-${id}.md`), 'utf8'),
            ]),
        ) as FactorySettingsState['defaults'];

    return {
        read(models: FactoryModelGroup[]): FactorySettingsState {
            const state = readFactorySettings(dir);

            return { ...state, revision: revision(state.settings), defaults: defaults(), models };
        },
        save(input: Record<string, unknown>) {
            const current = readFactorySettings(dir);

            if (input.revision !== revision(current.settings))
                return {
                    status: 409,
                    body: {
                        error: 'Settings changed in another window. Your draft is kept. Reopen Settings to load the saved choices.',
                    },
                };

            try {
                const settings = writeFactorySettings(input.settings, dir);

                return { status: 200, body: { settings, revision: revision(settings), error: null } };
            } catch (error) {
                return {
                    status: 400,
                    body: { error: error instanceof Error ? error.message : 'Could not save settings.' },
                };
            }
        },
    };
}
