import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { resolveTestRuntime } from './project-runtime.ts';

test('resolves checks Node from board PATH once, including when the board itself runs under Electron', () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-runtime-'));
    const bin = join(dir, 'bin');
    const runtime = { node: '/board/bin/node', version: 'v24.0.0' };

    mkdirSync(bin);
    writeFileSync(join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(runtime)}'\n`);
    chmodSync(join(bin, 'node'), 0o755);
    vi.stubEnv('PATH', bin);

    try {
        expect(resolveTestRuntime(dir, 'fake/app')).toEqual(runtime);
        writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 70\n');

        const saved = { node: '/saved/bin/node', version: 'v25.0.0' };

        writeFileSync(join(dir, 'project-runtimes.json'), JSON.stringify({ 'fake/app': saved }));
        expect(resolveTestRuntime(dir, 'FAKE/APP')).toEqual(saved);
    } finally {
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
    }
});
