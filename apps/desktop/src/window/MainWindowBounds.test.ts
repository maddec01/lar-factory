import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as NodePath from 'node:path';

import { tempDir } from '../../test/support.ts';
import * as MainWindowBounds from './MainWindowBounds.ts';

const laptop = { x: 0, y: 0, width: 1512, height: 982 };

describe('resolveInitialMainWindowBounds', () => {
    it("opens at the default size, centred, when the saved bounds were on a display that's gone", () => {
        const saved = { x: 1600, y: 100, width: 1400, height: 900 };

        assert.deepStrictEqual(MainWindowBounds.resolveInitialMainWindowBounds(saved, [laptop]), {
            width: 1280,
            height: 860,
        });
    });
});

const tempFile = () => NodePath.join(tempDir('window-state-'), 'settings', 'window-state.json');

describe('MainWindowBounds.atFile', () => {
    it.effect('reads nothing before a save, then the bounds and maximized state last written', () =>
        Effect.gen(function* () {
            const file = tempFile();

            assert.deepStrictEqual(yield* MainWindowBounds.atFile(file).read, {
                mainWindowBounds: null,
                mainWindowMaximized: false,
            });

            const bounds = { x: 10, y: 20, width: 1300, height: 900 };

            yield* MainWindowBounds.atFile(file).write(bounds, true);
            assert.deepStrictEqual(yield* MainWindowBounds.atFile(file).read, {
                mainWindowBounds: bounds,
                mainWindowMaximized: true,
            });
        }),
    );
});
