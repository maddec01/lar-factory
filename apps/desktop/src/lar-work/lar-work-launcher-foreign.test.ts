import { assert, it } from '@effect/vitest';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';

import { tempDir } from '../../test/support.ts';
import * as LarWorkLauncher from './lar-work-launcher.ts';

it('leaves a file the app did not install alone and reports it', () => {
    const home = tempDir('lar-work-home-');
    const path = LarWorkLauncher.launcherPath(home);

    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, '#!/bin/sh\necho mine\n', { mode: 0o755 });

    assert.deepStrictEqual(
        LarWorkLauncher.install({
            home,
            executablePath: '/unused/electron',
            commandFile: '/unused/lar-work.mjs',
            dataDir: boardDataDir(home),
        }),
        { kind: 'foreign', path },
    );
    assert.strictEqual(NodeFS.readFileSync(path, 'utf8'), '#!/bin/sh\necho mine\n');
});
