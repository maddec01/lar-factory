import type { BoardAppBridge } from '@lar-factory/shared';
import * as Effect from 'effect/Effect';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vite-plus/test';

import { makeBundle, tempDir } from '../test/support.ts';
import * as IpcChannels from './ipc-channels.ts';
import { boardPageOnly, makeInstallBoard } from './skills/install-board.ts';
import { runInstall } from './skills/install-runner.ts';
import { makeChecks } from './skills/skill-install.ts';

const ipc = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));

vi.mock('electron', () => ({
    contextBridge: { exposeInMainWorld: ipc.expose },
    ipcRenderer: { ...ipc, sendSync: () => undefined },
}));

it.each(['dismissed'] as const)(
    'recovers %s closure through page reload and a board-server restart without another install',
    async (reason) => {
        const home = tempDir('overview-recovery-');

        mkdirSync(join(home, '.claude'));

        const bundle = makeBundle();
        const run = vi.fn(runInstall);
        const checks = (await Effect.runPromise(
            makeChecks(
                { home, bundle, version: '1.0.0', isPackaged: true, argv: [], env: {} },
                () => Effect.succeed({ available: false, reason: 'not-running' }),
                run,
            ),
        ))!;
        const board = makeInstallBoard({ home, bundle, version: '1.0.0' }, checks);
        let origin = 'http://127.0.0.1:4319';
        let caller = `${origin}/`;
        const requireBoard = boardPageOnly(() => origin, 'Only the current board page can change the install');

        ipc.invoke.mockImplementation(async (channel, ...args) => {
            requireBoard(caller);

            if (channel === IpcChannels.INSTALL_GET_STATE) return board.snapshot();

            if (channel === IpcChannels.INSTALL_CLOSE_OVERVIEW) return board.closeOverview(args[0], args[1]);

            throw new Error(`Unexpected operation ${channel}`);
        });
        await Effect.runPromise(checks.atLaunch);
        vi.resetModules();
        await import('./preload.ts');

        const first = ipc.expose.mock.calls.at(-1)![1] as BoardAppBridge;
        const completed = await first.getInstallState();
        const closed = await first.closeInstallOverview(reason, completed.revision!);

        expect(closed.overview).toBe(reason);
        expect(closed.targets[0]?.skills).toEqual([{ name: 'lar-work', state: 'installed' }]);

        vi.resetModules();
        await import('./preload.ts');

        const reloaded = ipc.expose.mock.calls.at(-1)![1] as BoardAppBridge;

        expect(await reloaded.getInstallState()).toEqual(closed);
        origin = '';
        await expect(reloaded.getInstallState()).rejects.toThrow('Only the current board page');
        origin = 'http://127.0.0.1:4320';
        await expect(reloaded.closeInstallOverview(reason, closed.revision!)).rejects.toThrow(
            'Only the current board page',
        );
        caller = `${origin}/`;
        expect(await reloaded.getInstallState()).toEqual(closed);
        expect(run).toHaveBeenCalledOnce();
    },
);
