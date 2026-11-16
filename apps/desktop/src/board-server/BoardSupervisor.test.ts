import { assert, describe, it } from '@effect/vitest';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Scope from 'effect/Scope';
import { TestClock } from 'effect/testing';

import { BoardServerError, type RunningBoard } from './BoardServer.ts';
import * as BoardSupervisor from './BoardSupervisor.ts';

/** A fake server per start: each gets the next port and exits when the test says so. */
const makeFakeServer = (options?: { readonly failStarts?: number }) =>
    Effect.sync(() => {
        const children: Array<{ port: number; crash: Effect.Effect<void>; stopped: boolean }> = [];
        let failures = options?.failStarts ?? 0;
        const start = Effect.gen(function* () {
            if (failures > 0) {
                failures -= 1;

                return yield* new BoardServerError({ message: 'fake start failed' });
            }

            const exit = yield* Deferred.make<string>();
            const child = {
                port: 5000 + children.length,
                crash: Deferred.succeed(exit, 'on SIGKILL').pipe(Effect.asVoid),
                stopped: false,
            };

            children.push(child);
            yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                    child.stopped = true;
                }),
            );

            const board: RunningBoard = {
                pid: child.port,
                url: new URL(`http://127.0.0.1:${child.port}/`),
                exited: Deferred.await(exit),
            };

            return board;
        });

        return { children, start };
    });

const readyUrls = () => {
    const urls: Array<string> = [];

    return {
        urls,
        onReady: (url: URL) =>
            Effect.sync(() => {
                urls.push(url.href);
            }),
    };
};

const delays = { initialDelay: Duration.millis(500), maxDelay: Duration.seconds(4) };

describe('supervise', () => {
    it.effect('starts the server again after it crashes and reports the new page', () =>
        Effect.gen(function* () {
            const server = yield* makeFakeServer();
            const ready = readyUrls();

            yield* BoardSupervisor.supervise(server.start, ready, delays).pipe(Effect.forkScoped);
            yield* Effect.yieldNow;
            assert.deepStrictEqual(ready.urls, ['http://127.0.0.1:5000/']);

            yield* server.children[0]!.crash;
            yield* Effect.yieldNow;
            assert.isTrue(server.children[0]!.stopped);
            assert.strictEqual(server.children.length, 1);

            yield* TestClock.adjust(Duration.millis(500));
            assert.deepStrictEqual(ready.urls, ['http://127.0.0.1:5000/', 'http://127.0.0.1:5001/']);
        }).pipe(Effect.scoped),
    );

    it.effect('stops the running server when its scope closes', () =>
        Effect.gen(function* () {
            const server = yield* makeFakeServer();
            const scope = yield* Scope.make();

            yield* BoardSupervisor.supervise(server.start, readyUrls(), delays).pipe(Effect.forkIn(scope));
            yield* Effect.yieldNow;
            assert.isFalse(server.children[0]!.stopped);
            yield* Scope.close(scope, Exit.void);
            assert.isTrue(server.children[0]!.stopped);
        }),
    );
});

describe('makeControl', () => {
    it.effect('stops the running server and starts supervising again', () =>
        Effect.gen(function* () {
            const server = yield* makeFakeServer();
            const ready = readyUrls();
            const control = yield* BoardSupervisor.makeControl(BoardSupervisor.supervise(server.start, ready, delays));

            yield* control.start;
            yield* control.start;
            yield* Effect.yieldNow;
            // A second start while one runs starts no second server.
            assert.deepStrictEqual(ready.urls, ['http://127.0.0.1:5000/']);

            yield* control.stop;
            assert.isTrue(server.children[0]!.stopped);
            yield* TestClock.adjust(Duration.seconds(10));
            assert.strictEqual(server.children.length, 1);

            yield* control.start;
            yield* Effect.yieldNow;
            assert.deepStrictEqual(ready.urls, ['http://127.0.0.1:5000/', 'http://127.0.0.1:5001/']);
        }).pipe(Effect.scoped),
    );
});
