import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Scope from 'effect/Scope';
import * as NodePath from 'node:path';

import * as BoardServer from './BoardServer.ts';

const fakeBoard = NodePath.resolve(import.meta.dirname, '../../test/fake-board.mjs');
const appDir = NodePath.resolve(import.meta.dirname, '../..');

const fakeConfig = (env: Record<string, string>): BoardServer.StartConfig => ({
    ...BoardServer.makeStartConfig({
        ...BoardServer.locate(appDir, false),
        executablePath: process.execPath,
        env: { ...process.env, ...env },
        secret: 'test-secret',
    }),
    args: [fakeBoard],
});

const isRunning = (pid: number) => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
};

describe('locate', () => {
    it("runs the bundled server, with the skills bundle and the app's release, from the packaged app's Resources", () => {
        assert.deepStrictEqual(
            BoardServer.locate('/Applications/Board.app/Contents/Resources/app.asar', true, '2.0.0'),
            {
                serverDir: '/Applications/Board.app/Contents/Resources/server',
                serverFile: '/Applications/Board.app/Contents/Resources/server/dist/server.mjs',
                bundleDir: '/Applications/Board.app/Contents/Resources/bundle',
                release: '2.0.0',
            },
        );
    });

    it('gives a checkout no release, whatever the app reports', () => {
        assert.deepStrictEqual(BoardServer.locate('/repo/apps/desktop', false, '2.0.0'), {
            serverDir: '/repo/apps/server',
            serverFile: '/repo/apps/server/src/server.ts',
        });
    });
});

describe('makeStartConfig', () => {
    it('runs the server file with the given executable in Node mode and the launch secret', () => {
        const config = BoardServer.makeStartConfig({
            executablePath: '/Applications/Board.app/Contents/MacOS/Board',
            serverDir: '/repo/apps/server',
            serverFile: '/repo/apps/server/src/server.ts',
            env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '0' },
            secret: 'launch-secret',
        });

        assert.deepStrictEqual(config, {
            executablePath: '/Applications/Board.app/Contents/MacOS/Board',
            args: ['--disable-warning=ExperimentalWarning', '/repo/apps/server/src/server.ts'],
            cwd: '/repo/apps/server',
            env: {
                PATH: '/usr/bin',
                ELECTRON_RUN_AS_NODE: '1',
                BOARD_APP_SECRET: 'launch-secret',
            },
        });
    });

    it("passes a packaged app's release to the server, and no release from a checkout", () => {
        const env = (isPackaged: boolean) =>
            BoardServer.makeStartConfig({
                ...BoardServer.locate('/app/Resources/app.asar', isPackaged, '2.0.0'),
                executablePath: '/app/Board',
                env: {},
                secret: 'launch-secret',
            }).env;

        assert.strictEqual(env(true).BOARD_APP_VERSION, '2.0.0');
        assert.notProperty(env(false), 'BOARD_APP_VERSION');
    });
});

describe('start', () => {
    it.live('returns the page on the port the server reports, once /healthz answers', () =>
        Effect.gen(function* () {
            const board = yield* BoardServer.start(fakeConfig({ FAKE_BOARD_BUSY: '3' }));
            const hits = yield* Effect.promise(() => fetch(new URL('/hits', board.url)).then((res) => res.json()));

            assert.strictEqual(hits, 4);
            assert.match(board.url.href, /^http:\/\/127\.0\.0\.1:\d+\/$/);
        }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
    );

    /** The fake server's answer to its skill check, once it comes. */
    const skillAnswer = (url: URL) =>
        Effect.promise(async () => {
            for (let attempt = 0; attempt < 100; attempt++) {
                const body = await fetch(new URL('/answer', url)).then((res) => res.json());

                if (body) return body;

                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            return null;
        });

    it.live("answers the server's skill check over its IPC channel", () =>
        Effect.gen(function* () {
            const board = yield* BoardServer.start(fakeConfig({ FAKE_BOARD_CHECK: '1' }), {
                checkSkills: () => Promise.resolve({ refusal: 'tdd is blocked' }),
            });

            assert.deepStrictEqual(yield* skillAnswer(board.url), {
                type: 'skills-checked',
                id: 7,
                refusal: 'tdd is blocked',
            });
        }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
    );

    it.live('stops the server when its scope closes', () =>
        Effect.gen(function* () {
            const scope = yield* Scope.make();
            const board = yield* BoardServer.start(fakeConfig({})).pipe(Scope.provide(scope));

            assert.isTrue(isRunning(board.pid));
            yield* Scope.close(scope, Exit.void);
            assert.isFalse(isRunning(board.pid));
        }).pipe(Effect.provide(NodeHttpClient.layerUndici)),
    );
});
