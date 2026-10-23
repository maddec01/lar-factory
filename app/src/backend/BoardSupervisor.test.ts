import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import { TestClock } from "effect/testing";

import * as BoardServer from "./BoardServer.ts";
import { BoardServerError, type RunningBoard } from "./BoardServer.ts";
import * as BoardSupervisor from "./BoardSupervisor.ts";

/** A fake server per start: each gets the next port and exits when the test says so. */
const makeFakeServer = (options?: { readonly failStarts?: number }) =>
  Effect.gen(function* () {
    const children: Array<{ port: number; crash: Effect.Effect<void>; stopped: boolean }> = [];
    let failures = options?.failStarts ?? 0;
    const start = Effect.gen(function* () {
      if (failures > 0) {
        failures -= 1;
        return yield* new BoardServerError({ message: "fake start failed" });
      }
      const exit = yield* Deferred.make<string>();
      const child = { port: 5000 + children.length, crash: Deferred.succeed(exit, "on SIGKILL").pipe(Effect.asVoid), stopped: false };
      children.push(child);
      yield* Effect.addFinalizer(() => Effect.sync(() => { child.stopped = true; }));
      const board: RunningBoard = { pid: child.port, url: new URL(`http://127.0.0.1:${child.port}/`), exited: Deferred.await(exit) };
      return board;
    });
    return { children, start };
  });

const readyUrls = () => {
  const urls: Array<string> = [];
  return { urls, onReady: (url: URL) => Effect.sync(() => { urls.push(url.href); }) };
};

const delays = { initialDelay: Duration.millis(500), maxDelay: Duration.seconds(4) };

describe("supervise", () => {
  it.effect("starts the server again after it crashes and reports the new page", () =>
    Effect.gen(function* () {
      const server = yield* makeFakeServer();
      const ready = readyUrls();
      yield* BoardSupervisor.supervise(server.start, ready, delays).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(ready.urls, ["http://127.0.0.1:5000/"]);

      yield* server.children[0]!.crash;
      yield* Effect.yieldNow;
      assert.isTrue(server.children[0]!.stopped);
      assert.strictEqual(server.children.length, 1);

      yield* TestClock.adjust(Duration.millis(500));
      assert.deepStrictEqual(ready.urls, ["http://127.0.0.1:5000/", "http://127.0.0.1:5001/"]);
    }).pipe(Effect.scoped),
  );

  it.effect("waits twice as long after each failed restart, up to the cap", () =>
    Effect.gen(function* () {
      const server = yield* makeFakeServer({ failStarts: 5 });
      const ready = readyUrls();
      yield* BoardSupervisor.supervise(server.start, ready, delays).pipe(Effect.forkScoped);
      // Failed starts at 0, then after 0.5, 1, 2, 4 and 4 seconds; the sixth start succeeds.
      for (const ms of [500, 1000, 2000, 4000]) {
        yield* TestClock.adjust(Duration.millis(ms - 1));
        assert.strictEqual(server.children.length, 0);
        yield* TestClock.adjust(Duration.millis(1));
      }
      yield* TestClock.adjust(Duration.millis(3999));
      assert.strictEqual(server.children.length, 0);
      yield* TestClock.adjust(Duration.millis(1));
      assert.deepStrictEqual(ready.urls, ["http://127.0.0.1:5000/"]);
    }).pipe(Effect.scoped),
  );

  it.effect("reports why each server stopped or didn't start before it restarts", () =>
    Effect.gen(function* () {
      const server = yield* makeFakeServer({ failStarts: 1 });
      const reasons: Array<string> = [];
      const events = { ...readyUrls(), onRestart: (reason: string) => Effect.sync(() => { reasons.push(reason); }) };
      yield* BoardSupervisor.supervise(server.start, events, delays).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.deepStrictEqual(reasons, ["fake start failed"]);
      yield* TestClock.adjust(Duration.millis(500));
      yield* server.children[0]!.crash;
      yield* Effect.yieldNow;
      assert.deepStrictEqual(reasons, ["fake start failed", "the board server exited on SIGKILL"]);
    }).pipe(Effect.scoped),
  );

  it.effect("resets the wait once a server comes up", () =>
    Effect.gen(function* () {
      const server = yield* makeFakeServer({ failStarts: 2 });
      const ready = readyUrls();
      yield* BoardSupervisor.supervise(server.start, ready, delays).pipe(Effect.forkScoped);
      yield* TestClock.adjust(Duration.millis(500 + 1000));
      assert.strictEqual(server.children.length, 1);

      yield* server.children[0]!.crash;
      yield* TestClock.adjust(Duration.millis(500));
      assert.strictEqual(server.children.length, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("starts no server once its scope closes during a pending restart", () =>
    Effect.gen(function* () {
      const server = yield* makeFakeServer();
      const ready = readyUrls();
      const scope = yield* Scope.make();
      const fiber = yield* BoardSupervisor.supervise(server.start, ready, delays).pipe(Effect.forkIn(scope));
      yield* Effect.yieldNow;
      yield* server.children[0]!.crash;
      yield* Effect.yieldNow;

      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust(Duration.seconds(10));
      assert.strictEqual(server.children.length, 1);
      assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)));
    }),
  );

  it.effect("stops the running server when its scope closes", () =>
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

describe("supervise with a real server", () => {
  it.live("brings the board back after the server is killed", () =>
    Effect.gen(function* () {
      const config = {
        ...BoardServer.makeStartConfig({
          ...BoardServer.locate(NodePath.resolve(import.meta.dirname, "../..")),
          executablePath: process.execPath,
          env: process.env,
          secret: "test-secret",
        }),
        args: [NodePath.resolve(import.meta.dirname, "../../test/fake-board.mjs")],
      };
      const pages = yield* Queue.unbounded<URL>();
      let pid = 0;
      const start = BoardServer.start(config).pipe(Effect.tap((board) => Effect.sync(() => { pid = board.pid; })));
      yield* BoardSupervisor.supervise(start, { onReady: (url) => Queue.offer(pages, url).pipe(Effect.asVoid) }, delays).pipe(
        Effect.forkScoped,
      );
      yield* Queue.take(pages);
      const firstPid = pid;
      process.kill(firstPid, "SIGKILL");

      const page = yield* Queue.take(pages);
      assert.notStrictEqual(pid, firstPid);
      const health = yield* Effect.promise(() => fetch(new URL("/healthz", page)).then((res) => res.status));
      assert.strictEqual(health, 200);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
  );
});
