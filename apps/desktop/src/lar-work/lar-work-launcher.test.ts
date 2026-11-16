import { assert, beforeAll, describe, it } from '@effect/vitest';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import * as Effect from 'effect/Effect';
import electron from 'electron';
// Builds the lar-work bundle as the pack step does and runs it, directly and through the launcher, with Electron's
// Node from a folder that holds no factory files.
import * as NodeChildProcess from 'node:child_process';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';
import { build } from 'vite-plus/pack';

import { tempDir } from '../../test/support.ts';
import { larWorkPack } from '../../vite.config.ts';
import * as LarWorkLauncher from './lar-work-launcher.ts';

const APP_DIR = NodePath.resolve(import.meta.dirname, '../..');
// The `electron` package's main export is the path of its binary.
const ELECTRON = electron as unknown as string;

let commandFile: string;

beforeAll(async () => {
    const outDir = tempDir('lar-work-bundle-');

    await build({ ...larWorkPack, cwd: APP_DIR, outDir, logLevel: 'silent', config: false });
    commandFile = NodePath.join(outDir, 'lar-work.mjs');
}, 60_000);

/** Runs `file` with `args` from `cwd`, a new empty folder outside any repository by default, with `home` as HOME. */
const runFrom = (
    file: string,
    args: ReadonlyArray<string>,
    { cwd = tempDir('no-factory-files-'), home = tempDir('lar-work-home-') } = {},
) => NodeChildProcess.spawnSync(file, args, { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home } });

const install = (home: string, file = commandFile, dataDir = boardDataDir(home)) =>
    LarWorkLauncher.install({ home, executablePath: ELECTRON, commandFile: file, dataDir });

describe('install', () => {
    it("gives Claude Code and Codex threads the board's database whatever their HOME and folder", () => {
        const appHome = tempDir('app-home-');
        const dataDir = boardDataDir(appHome, {});

        install(appHome, commandFile, dataDir);

        const agents = [
            { driver: 'claudeAgent', home: tempDir('claude-home-') },
            { driver: 'codex', home: tempDir('codex-home-') },
        ];
        const workIds = agents.map(({ driver, home }) => {
            const created = runFrom(
                LarWorkLauncher.launcherPath(appHome),
                ['create', '--title', driver, '--repository', 'maddec01/lar', '--kind', 'build'],
                { cwd: tempDir('worktree-'), home },
            );

            assert.strictEqual(created.status, 0, created.stderr);

            return JSON.parse(created.stdout).workId as string;
        });

        for (const [index, workId] of workIds.entries()) {
            const read = runFrom(LarWorkLauncher.launcherPath(appHome), ['read', workId, '--data-dir', dataDir]);

            assert.strictEqual(read.status, 0, read.stderr);
            assert.strictEqual(JSON.parse(read.stdout).title, agents[index]!.driver);
        }
    });
});

describe('onLaunch', () => {
    const launch = (home: string, argv: ReadonlyArray<string>) =>
        LarWorkLauncher.onLaunch({
            isPackaged: false,
            argv,
            home,
            executablePath: ELECTRON,
            commandFile,
            dataDir: boardDataDir(home),
        });

    it.effect('installs nothing from a dev run without the launcher flag', () =>
        Effect.gen(function* () {
            const home = tempDir('dev-home-');

            yield* launch(home, ['.']);

            assert.isFalse(NodeFS.existsSync(LarWorkLauncher.launcherPath(home)));
        }),
    );

    it.effect('installs the launcher from a dev run with --install-launcher', () =>
        Effect.gen(function* () {
            const home = tempDir('dev-home-');

            yield* launch(home, ['.', '--install-launcher']);

            assert.isTrue(NodeFS.existsSync(LarWorkLauncher.launcherPath(home)));
        }),
    );
});
