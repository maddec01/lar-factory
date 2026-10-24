import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import * as BoardServer from "./BoardServer.ts";

const fakeBoard = NodePath.resolve(import.meta.dirname, "../../test/fake-board.mjs");
const appDir = NodePath.resolve(import.meta.dirname, "../..");

const fakeConfig = (env: Record<string, string>): BoardServer.StartConfig => ({
  ...BoardServer.makeStartConfig({ ...BoardServer.locate(appDir, false), executablePath: process.execPath, env: { ...process.env, ...env }, secret: "test-secret" }),
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

describe("locate", () => {
  it("finds apps/server and the root config.json beside apps/desktop in development", () => {
    assert.deepStrictEqual(BoardServer.locate("/repo/apps/desktop", false), {
      boardDir: "/repo/apps/server",
      configFile: "/repo/config.json",
    });
  });

  it("finds the bundled board/ and config.json in the packaged app's Resources", () => {
    assert.deepStrictEqual(BoardServer.locate("/Applications/Board.app/Contents/Resources/app.asar", true), {
      boardDir: "/Applications/Board.app/Contents/Resources/board",
      configFile: "/Applications/Board.app/Contents/Resources/config.json",
    });
  });
});

describe("makeStartConfig", () => {
  it("runs board/src/server.ts with the given executable in Node mode, the config file and the launch secret", () => {
    const config = BoardServer.makeStartConfig({
      executablePath: "/Applications/Board.app/Contents/MacOS/Board",
      boardDir: "/repo/board",
      configFile: "/repo/config.json",
      env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "0" },
      secret: "launch-secret",
    });
    assert.deepStrictEqual(config, {
      executablePath: "/Applications/Board.app/Contents/MacOS/Board",
      args: ["--disable-warning=ExperimentalWarning", "/repo/board/src/server.ts"],
      cwd: "/repo/board",
      env: {
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1",
        BOARD_CONFIG_FILE: "/repo/config.json",
        BOARD_APP_SECRET: "launch-secret",
      },
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

  it.live("reports how the server exited", () =>
    Effect.gen(function* () {
      const board = yield* BoardServer.start(fakeConfig({}));
      process.kill(board.pid, "SIGKILL");
      assert.strictEqual(yield* board.exited, "on SIGKILL");
    }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
  );

  it.live("starts the real board in sample mode, guarding writes and drains with the launch secret", () =>
    Effect.gen(function* () {
      const config = BoardServer.makeStartConfig({
        ...BoardServer.locate(appDir, false),
        executablePath: process.execPath,
        env: {
          ...process.env,
          BOARD_DATA_FILE: "test/sample.json",
          T3_SETTINGS: "test/t3-settings.sample.json",
          T3_MODEL_MANIFEST: "test/model-manifest.sample.json",
        },
        secret: "launch-secret",
      });
      const board = yield* BoardServer.start(config);
      const page = yield* Effect.promise(() => fetch(board.url).then((res) => res.text()));
      assert.include(page, "<html");
      // Each POST comes from the page's origin, as JSON, as the page's and status.sh's do.
      const post = (path: string, headers: Record<string, string> = {}) =>
        Effect.promise(() =>
          fetch(new URL(path, board.url), {
            method: "POST",
            headers: { Origin: board.url.origin, "Content-Type": "application/json", ...headers },
            body: "{}",
          }).then(async (res) => `${res.status} ${await res.text()}`),
        );
      const refused = '403 {"error":"Submit from the board app."}';
      assert.strictEqual(yield* post("/api/queue"), refused, "a write without the launch secret");
      // Sample mode turns the write down itself once the secret gets it past the check.
      assert.notStrictEqual(yield* post("/api/queue", { "X-Board-Secret": "launch-secret" }), refused);
      assert.match(yield* post("/api/read"), /^2\d\d /, "status.sh's refresh stays open");

      // A drain with the wrong secret fails and leaves writes open; with the launch secret it closes them.
      const failed = yield* Effect.exit(BoardServer.drain(board.url, "wrong-secret"));
      assert.match(String(Exit.isFailure(failed) && failed.cause), /could not drain the board's writes/);
      assert.notMatch(yield* post("/api/queue", { "X-Board-Secret": "launch-secret" }), /^503 /);
      yield* BoardServer.drain(board.url, "launch-secret");
      assert.match(yield* post("/api/queue", { "X-Board-Secret": "launch-secret" }), /^503 /);
    }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
  );
});
