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
  it("runs apps/server's source beside apps/desktop in development", () => {
    assert.deepStrictEqual(BoardServer.locate("/repo/apps/desktop", false), {
      serverDir: "/repo/apps/server",
      serverFile: "/repo/apps/server/src/server.ts",
    });
  });

  it("runs the bundled server, with the skills bundle, from the packaged app's Resources", () => {
    assert.deepStrictEqual(BoardServer.locate("/Applications/Board.app/Contents/Resources/app.asar", true), {
      serverDir: "/Applications/Board.app/Contents/Resources/server",
      serverFile: "/Applications/Board.app/Contents/Resources/server/dist/server.mjs",
      bundleDir: "/Applications/Board.app/Contents/Resources/bundle",
    });
  });
});

describe("makeStartConfig", () => {
  it("tells the server that the app checks skills when it does", () => {
    const input = { executablePath: "/Board", serverDir: "/server", serverFile: "/server/dist/server.mjs", configFile: "/config.json", env: {}, secret: "s" };
    assert.equal(BoardServer.makeStartConfig({ ...input, checksSkills: true }).env.BOARD_SKILL_CHECK, "1");
    assert.equal(BoardServer.makeStartConfig(input).env.BOARD_SKILL_CHECK, undefined);
  });

  it("names the skills bundle when the app has one", () => {
    const config = BoardServer.makeStartConfig({
      executablePath: "/Board", serverDir: "/server", serverFile: "/server/dist/server.mjs",
      bundleDir: "/bundle", env: {}, secret: "launch-secret",
    });
    assert.equal(config.env.BOARD_BUNDLE_DIR, "/bundle");
  });

  it("runs the server file with the given executable in Node mode and the launch secret", () => {
    const config = BoardServer.makeStartConfig({
      executablePath: "/Applications/Board.app/Contents/MacOS/Board",
      serverDir: "/repo/apps/server",
      serverFile: "/repo/apps/server/src/server.ts",
      env: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "0" },
      secret: "launch-secret",
    });
    assert.deepStrictEqual(config, {
      executablePath: "/Applications/Board.app/Contents/MacOS/Board",
      args: ["--disable-warning=ExperimentalWarning", "/repo/apps/server/src/server.ts"],
      cwd: "/repo/apps/server",
      env: {
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1",
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

  /** The fake server's answer to its skill check, once it comes. */
  const skillAnswer = (url: URL) =>
    Effect.promise(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const body = await fetch(new URL("/answer", url)).then((res) => res.json());
        if (body) return body;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return null;
    });

  it.live("answers the server's skill check over its IPC channel", () =>
    Effect.gen(function* () {
      const board = yield* BoardServer.start(fakeConfig({ FAKE_BOARD_CHECK: "1" }), {
        checkSkills: () => Promise.resolve("tdd is blocked"),
      });
      assert.deepStrictEqual(yield* skillAnswer(board.url), { type: "skills-checked", id: 7, refusal: "tdd is blocked" });
    }).pipe(Effect.scoped, Effect.provide(NodeHttpClient.layerUndici)),
  );

  it.live("refuses the build when the skill check itself fails", () =>
    Effect.gen(function* () {
      const board = yield* BoardServer.start(fakeConfig({ FAKE_BOARD_CHECK: "1" }), {
        checkSkills: () => Promise.reject(new Error("the check died")),
      });
      const answer = yield* skillAnswer(board.url);
      assert.strictEqual(answer?.id, 7);
      assert.include(answer?.refusal, "couldn't check its skills");
      assert.include(answer?.refusal, "the check died");
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
          BOARD_DATA_FILE: "../../packages/shared/test/sample.json",
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
