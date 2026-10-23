import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import * as BoardServer from "./BoardServer.ts";

const fakeBoard = NodePath.resolve(import.meta.dirname, "../../test/fake-board.mjs");
const boardDir = NodePath.resolve(import.meta.dirname, "../../../board");

const fakeConfig = (env: Record<string, string>): BoardServer.StartConfig => ({
  ...BoardServer.makeStartConfig({ executablePath: process.execPath, boardDir, env: { ...process.env, ...env } }),
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

describe("makeStartConfig", () => {
  it("runs board/src/server.ts with the given executable in Node mode", () => {
    const config = BoardServer.makeStartConfig({
      executablePath: "/Applications/Board.app/Contents/MacOS/Board",
      boardDir: "/repo/board",
      env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "0" },
    });
    assert.deepStrictEqual(config, {
      executablePath: "/Applications/Board.app/Contents/MacOS/Board",
      args: ["--disable-warning=ExperimentalWarning", "/repo/board/src/server.ts"],
      cwd: "/repo/board",
      env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
    });
  });
});

describe("start", () => {
  it.live("returns the page on the port the server reports, once /healthz answers", () =>
    Effect.gen(function* () {
      const board = yield* BoardServer.start(fakeConfig({ FAKE_BOARD_BUSY: "3" }));
      const hits = yield* Effect.promise(() => fetch(new URL("/hits", board.url)).then((res) => res.json()));
      assert.strictEqual(hits, 4);
      assert.match(board.url.href, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
  );

  it.live("fails when the server exits before it reports a port", () =>
    Effect.gen(function* () {
      const exit = yield* BoardServer.start(fakeConfig({ FAKE_BOARD: "crash" })).pipe(Effect.scoped, Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      assert.match(String(Exit.isFailure(exit) && exit.cause), /exited with code 3 before it reported a port/);
    }).pipe(Effect.provide(NodeHttpClient.layerUndici)),
  );

  it.live("fails when the server never reports a port", () =>
    Effect.gen(function* () {
      const exit = yield* BoardServer.start(fakeConfig({ FAKE_BOARD: "silent" }), {
        portTimeout: Duration.millis(300),
      }).pipe(Effect.scoped, Effect.exit);
      assert.match(String(Exit.isFailure(exit) && exit.cause), /reported no port within/);
    }).pipe(Effect.provide(NodeHttpClient.layerUndici)),
  );

  it.live("stops the server when its scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const board = yield* BoardServer.start(fakeConfig({})).pipe(Scope.provide(scope));
      assert.isTrue(isRunning(board.pid));
      yield* Scope.close(scope, Exit.void);
      assert.isFalse(isRunning(board.pid));
    }).pipe(Effect.provide(NodeHttpClient.layerUndici)),
  );

  it.live("starts the real board in sample mode", () =>
    Effect.gen(function* () {
      const config = BoardServer.makeStartConfig({
        executablePath: process.execPath,
        boardDir,
        env: {
          ...process.env,
          BOARD_DATA_FILE: "test/sample.json",
          T3_SETTINGS: "test/t3-settings.sample.json",
          T3_MODEL_MANIFEST: "test/model-manifest.sample.json",
        },
      });
      const board = yield* BoardServer.start(config);
      const page = yield* Effect.promise(() => fetch(board.url).then((res) => res.text()));
      assert.include(page, "<html");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
  );
});
