import assert from 'node:assert/strict';
import {
    chmodSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { checkouts } from './repo-support.ts';
import { startBoard, writeRepositoryList } from './server-support.ts';
import { projectsDb } from './stats-db.ts';

const ICON = { kind: 'emoji', emoji: '🧪' };

function tempHome(t: TestContext): string {
    const home = mkdtempSync(join(tmpdir(), 'lar-sample-t3-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

    return home;
}

/** A board on the sample data reading T3 at `home`, whose real settings list only lar-web. */
async function sampleT3(t: TestContext, home: string, env: Record<string, string> = {}) {
    checkouts(home, {
        'lar-server': 'git@github.com:maddec01/lar-server.git',
        'lar-web': 'git@github.com:maddec01/lar-web.git',
    });

    if (!existsSync(join(home, 'Library'))) writeRepositoryList(home, ['maddec01/lar-web']);

    const T3_STATE_DB = projectsDb(
        t,
        ['lar-server', 'lar-web'].map((id) => ({ id, root: `${home}/Developer/lar/${id}` })),
    );
    const board = await startBoard(t, { recorded: false }, true, false, {
        HOME: home,
        T3_STATE_DB,
        BOARD_SAMPLE_T3: '1',
        FAKE_T3_ICON: JSON.stringify(ICON),
        ...env,
    });

    return board;
}

async function until(check: () => Promise<boolean>): Promise<void> {
    while (!(await check())) await new Promise((resolve) => setTimeout(resolve, 100));
}

/** A folder holding a `t3` that runs `script`, to put first on PATH. */
function fakeT3Bin(home: string, script: string): string {
    const bin = mkdtempSync(join(home, 'bin-'));

    writeFileSync(
        join(bin, 't3'),
        `#!/bin/sh
${script}
`,
    );
    chmodSync(join(bin, 't3'), 0o755);

    return bin;
}

/** Each file under `dir` with its size and modification time. */
function filesUnder(dir: string): Record<string, string> {
    return Object.fromEntries(
        readdirSync(dir, { recursive: true, encoding: 'utf8' }).flatMap((name) => {
            const stat = statSync(join(dir, name));

            return stat.isFile() ? [[name, `${stat.size}:${stat.mtimeMs}`]] : [];
        }),
    );
}

test('over its ticks it reads T3 and nothing else, and changes no file in the app data folder', async (t) => {
    const home = tempHome(t);
    const az = join(home, 'fake-az');
    const azLog = join(home, 'az-calls');

    writeFileSync(az, `#!/bin/sh\necho "$*" >> '${azLog}'\n`);
    chmodSync(az, 0o755);
    writeRepositoryList(home, ['maddec01/lar-web']);

    const dataDir = join(home, 'Library/Application Support/Lar Factory');
    const before = filesUnder(dataDir);
    const reads = join(home, 't3-reads');

    const board = await sampleT3(t, home, { AZ_PATH: az, FAKE_T3_READS: reads });
    const readCount = () => readFileSync(reads, 'utf8').split('\n').length;

    await until(async () => readCount() > 1);

    const startupReads = readCount();

    // Local ticks after startup, which keep reading availability.
    await until(async () => readCount() > startupReads + 1);

    assert.deepEqual(await board.calls(), [], 'no gh call');
    assert.equal(existsSync(azLog), false, 'no az call');
    assert.deepEqual(await board.t3Calls(), [], 'no t3 command');
    assert.deepEqual(filesUnder(dataDir), before);
});

test('a normal stop revokes its session before exiting', async (t) => {
    const home = tempHome(t);
    const log = join(home, 'revoked');
    const bin = fakeT3Bin(home, `sleep 0.4; echo "$*" >> '${log}'`);
    const board = await sampleT3(t, home, { PATH: `${bin}:${process.env.PATH}` });

    await board.stop();
    assert.equal(readFileSync(log, 'utf8').trim(), 'auth session revoke fake-session');
});
