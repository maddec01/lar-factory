// Builds the lar-work bundle as the pack step does and runs it, directly and through the launcher, with Electron's
// Node from a folder that holds no factory files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, beforeAll, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import electron from "electron";
import { build } from "vite-plus/pack";

import { tempDir } from "../../test/support.ts";
import { larWorkPack } from "../../vite.config.ts";
import * as LarWorkLauncher from "./lar-work-launcher.ts";

const APP_DIR = NodePath.resolve(import.meta.dirname, "../..");
// The `electron` package's main export is the path of its binary.
const ELECTRON = electron as unknown as string;

let commandFile: string;

beforeAll(async () => {
  const outDir = tempDir("lar-work-bundle-");
  await build({ ...larWorkPack, cwd: APP_DIR, outDir, logLevel: "silent", config: false });
  commandFile = NodePath.join(outDir, "lar-work.mjs");
}, 60_000);

/** Runs `file` with `args` from a new empty folder, outside any repository. */
const runFrom = (file: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync(file, args, {
    cwd: tempDir("no-factory-files-"),
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", HOME: tempDir("lar-work-home-") },
  });

const install = (home: string, file = commandFile) =>
  LarWorkLauncher.install({ home, executablePath: ELECTRON, commandFile: file });

describe("the bundled command", () => {
  it("prints its help and creates then reads a record with Electron's Node", () => {
    const run = (args: ReadonlyArray<string>) =>
      NodeChildProcess.spawnSync(ELECTRON, ["--disable-warning=ExperimentalWarning", commandFile, ...args], {
        cwd: tempDir("no-factory-files-"),
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" },
      });
    const dataDir = tempDir("lar-work-data-");

    const help = run(["--help"]);
    assert.strictEqual(help.status, 0, help.stderr);
    assert.include(help.stdout, "Usage: lar-work");

    const created = run(["create", "--title", "A build", "--repository", "maddec01/lar", "--kind", "build", "--data-dir", dataDir]);
    assert.strictEqual(created.status, 0, created.stderr);
    const { workId } = JSON.parse(created.stdout);
    const read = run(["read", workId, "--data-dir", dataDir]);
    assert.strictEqual(read.status, 0, read.stderr);
    assert.strictEqual(JSON.parse(read.stdout).repository, "maddec01/lar");
  });
});

describe("install", () => {
  it("installs a launcher that runs the bundled command", () => {
    const home = tempDir("lar-work-home-");

    assert.deepStrictEqual(install(home), { kind: "installed", path: LarWorkLauncher.launcherPath(home) });

    const dataDir = tempDir("lar-work-data-");
    const created = runFrom(LarWorkLauncher.launcherPath(home), ["create", "--title", "A concept", "--repository", "maddec01/lar", "--kind", "concept", "--data-dir", dataDir]);
    assert.strictEqual(created.status, 0, created.stderr);
    const read = runFrom(LarWorkLauncher.launcherPath(home), ["read", JSON.parse(created.stdout).workId, "--data-dir", dataDir]);
    assert.strictEqual(read.status, 0, read.stderr);
    assert.strictEqual(JSON.parse(read.stdout).kind, "concept");
  });

  it("leaves a current launcher as it is", () => {
    const home = tempDir("lar-work-home-");
    install(home);

    assert.deepStrictEqual(install(home), { kind: "unchanged", path: LarWorkLauncher.launcherPath(home) });
  });

  it("points the launcher at the app after the app moves", () => {
    const home = tempDir("lar-work-home-");
    install(home, "/Applications/Old Lar Factory.app/Contents/Resources/work-records/lar-work.mjs");
    const moved = NodePath.join(tempDir("moved-app-"), "it's here", "lar-work.mjs");
    NodeFS.mkdirSync(NodePath.dirname(moved));
    NodeFS.copyFileSync(commandFile, moved);

    assert.deepStrictEqual(install(home, moved), { kind: "installed", path: LarWorkLauncher.launcherPath(home) });
    const help = runFrom(LarWorkLauncher.launcherPath(home), ["--help"]);
    assert.strictEqual(help.status, 0, help.stderr);
    assert.notInclude(NodeFS.readFileSync(LarWorkLauncher.launcherPath(home), "utf8"), "Old Lar Factory");
  });

  it("leaves a file the app did not install alone and reports it", () => {
    const home = tempDir("lar-work-home-");
    const path = LarWorkLauncher.launcherPath(home);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, "#!/bin/sh\necho mine\n", { mode: 0o755 });

    assert.deepStrictEqual(install(home), { kind: "foreign", path });
    assert.strictEqual(NodeFS.readFileSync(path, "utf8"), "#!/bin/sh\necho mine\n");
  });

  it("leaves a symlink at the launcher's path alone", () => {
    const home = tempDir("lar-work-home-");
    const path = LarWorkLauncher.launcherPath(home);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.symlinkSync(commandFile, path);

    assert.deepStrictEqual(install(home), { kind: "foreign", path });
    assert.strictEqual(NodeFS.readlinkSync(path), commandFile);
  });
});

describe("onLaunch", () => {
  it.effect("installs nothing in a dev run", () =>
    Effect.gen(function* () {
      const home = tempDir("lar-work-home-");
      yield* LarWorkLauncher.onLaunch({ isPackaged: false, home, executablePath: ELECTRON, commandFile });
      assert.isFalse(NodeFS.existsSync(LarWorkLauncher.launcherPath(home)));
    }));

  it.effect("logs a foreign file instead of failing", () =>
    Effect.gen(function* () {
      const home = tempDir("lar-work-home-");
      const path = LarWorkLauncher.launcherPath(home);
      NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
      NodeFS.writeFileSync(path, "mine\n");
      yield* LarWorkLauncher.onLaunch({ isPackaged: true, home, executablePath: ELECTRON, commandFile });
      assert.strictEqual(NodeFS.readFileSync(path, "utf8"), "mine\n");
    }));
});
