import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { InstallSnapshot } from "@lar-factory/shared";
import { installTargets, type InstanceDiscovery } from "@lar-factory/shared/install-targets";
import { makeBundle, tempDir } from "../../test/support.ts";
import * as InstallBoard from "./install-board.ts";
import * as SkillInstall from "./skill-install.ts";

/** A throwaway home with two Claude profiles, ~/.claude and .claude-work. */
const makeHome = () => {
  const home = NodeFS.realpathSync(tempDir("board-home-"));
  NodeFS.mkdirSync(NodePath.join(home, ".claude"));
  NodeFS.mkdirSync(NodePath.join(home, ".claude-work"));
  return home;
};

const notRunning: InstanceDiscovery = { available: false, reason: "not-running" };

/** A packaged launch's checks into `home` and the board over them, with T3 answering `answer()`. */
const launch = (home: string, answer: () => InstanceDiscovery = () => notRunning, root?: string) =>
  Effect.gen(function* () {
    const input = { home, version: "1.0.0", bundle: makeBundle() };
    const checks = (yield* SkillInstall.makeChecks(
      { ...input, isPackaged: true, argv: [], env: root ? { [SkillInstall.ROOT_ENV]: root } : {} },
      () => Effect.sync(answer),
    ))!;
    return { checks, board: InstallBoard.makeInstallBoard(input, checks) };
  });

const target = (snapshot: InstallSnapshot, path: string) => snapshot.targets.find((candidate) => candidate.path === path);
const link = (home: string, profile: string) => NodePath.join(home, profile, "skills/lar-work");

describe("fromBoard", () => {
  it("accepts only a frame on the board's origin", () => {
    const board = "http://127.0.0.1:4319";
    assert.isTrue(InstallBoard.fromBoard("http://127.0.0.1:4319/?view=all", board));
    assert.isFalse(InstallBoard.fromBoard("http://127.0.0.1:4320/", board));
    assert.isFalse(InstallBoard.fromBoard("https://example.com/", board));
    assert.isFalse(InstallBoard.fromBoard(undefined, board));
    assert.isFalse(InstallBoard.fromBoard("not a url", board));
    assert.isFalse(InstallBoard.fromBoard("about:blank", ""));
  });
});

describe("snapshot", () => {
  it.effect("reads the same state after the page reopens, and sends each change to a subscriber", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const { checks, board } = yield* launch(home);
      const sent: Array<InstallSnapshot> = [];
      const stop = board.subscribe((snapshot) => sent.push(snapshot));
      yield* checks.atLaunch;
      stop();

      const reopened = InstallBoard.makeInstallBoard({ home, version: "1.0.0", bundle: "" }, checks).snapshot();
      assert.deepStrictEqual(board.snapshot(), sent.at(-1));
      assert.deepStrictEqual(reopened.targets.map(({ path, active }) => [path, active]), board.snapshot().targets.map(({ path, active }) => [path, active]));
      assert.deepStrictEqual(sent.map(({ running }) => running), ["launch", null]);
      const snapshot = board.snapshot();
      assert.deepStrictEqual([snapshot.installs, snapshot.installed, snapshot.discovery], [true, true, "waiting"]);
      assert.deepStrictEqual(snapshot.targets.map(({ path, active, locked, release }) => [path, active, locked, release]), [
        ["~/.agents/skills", true, true, "1.0.0"],
        ["~/.claude/skills", true, false, "1.0.0"],
        ["~/.claude-work/skills", false, false, undefined],
      ]);
      assert.deepStrictEqual(target(snapshot, "~/.claude/skills")?.skills, [{ name: "lar-work", state: "installed" }]);
      assert.deepStrictEqual(target(snapshot, "~/.claude-work/skills")?.skills, [{ name: "lar-work", state: "missing" }]);
    }));

  it.effect("says a T3 Claude target whose home doesn't exist isn't installed, and creates no home", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const missing = NodePath.join(home, ".claude-gone/skills");
      const answer: InstanceDiscovery = {
        available: true, instances: [{ id: "gone", driver: "claudeAgent", displayName: "Gone", enabled: true, targets: [{ kind: "claude", path: missing }] }],
      };
      const { checks, board } = yield* launch(home, () => answer);
      yield* checks.afterDiscovery;

      const gone = target(board.snapshot(), "~/.claude-gone/skills");
      assert.deepStrictEqual([gone?.active, gone?.locked, gone?.homeMissing], [false, true, true]);
      assert.strictEqual(target(board.snapshot(), "~/.claude/skills")?.homeMissing, undefined);
      assert.isFalse(NodeFS.existsSync(NodePath.dirname(missing)));
    }));

  it.effect("names T3's instances and the targets they read, and holds no environment or home", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const settings = {
        config: { homePath: "~/.claude-work" },
        environment: [{ name: "HOME", value: "/Users/hidden-home" }, { name: "API_TOKEN", value: "token-123" }],
      };
      const answer = (): InstanceDiscovery => ({
        available: true,
        instances: [{ id: "work", driver: "claudeAgent", displayName: "Work", enabled: false, targets: installTargets("claudeAgent", home, settings) }],
      });
      const { checks, board } = yield* launch(home, answer);
      yield* checks.afterDiscovery;

      const snapshot = board.snapshot();
      assert.deepStrictEqual(snapshot.instances, [{ id: "work", driver: "claudeAgent", displayName: "Work", enabled: false }]);
      assert.deepStrictEqual(target(snapshot, "~/.claude-work/skills")?.instances, ["work"]);
      assert.deepStrictEqual([target(snapshot, "~/.claude-work/skills")?.active, target(snapshot, "~/.claude-work/skills")?.locked], [true, true]);
      const text = JSON.stringify(snapshot);
      for (const hidden of [home, "/Users/hidden-home", "token-123", "API_TOKEN", "environment", "homePath"]) assert.notInclude(text, hidden);
    }));

  it.effect("reports the last check's Drift per target and skill", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const { checks, board } = yield* launch(home);
      yield* checks.atLaunch;
      NodeFS.writeFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "edited");
      yield* checks.beforeBuild();

      const snapshot = board.snapshot();
      assert.deepStrictEqual(target(snapshot, "~/.agents/skills")?.skills, [{ name: "lar-work", state: "drift" }]);
      assert.deepStrictEqual(snapshot.drift, [{ skill: "lar-work", paths: [{ place: "agents", path: "~/.agents/skills/lar-work" }] }]);

      const replaced = yield* Effect.promise(board.replace);
      assert.strictEqual(replaced.error, undefined);
      assert.deepStrictEqual(replaced.snapshot.replaced, ["lar-work"]);
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "utf8"), "# lar-work\n");
    }));

  it("lists the targets of a run that installs nothing, and refuses every operation without writing", async () => {
    const home = makeHome();
    const board = InstallBoard.makeInstallBoard({ home, version: "1.0.0", bundle: makeBundle() }, undefined);
    const snapshot = board.snapshot();
    assert.deepStrictEqual([snapshot.installs, snapshot.installed], [false, false]);
    assert.deepStrictEqual(snapshot.targets.map(({ path }) => path), ["~/.agents/skills", "~/.claude/skills", "~/.claude-work/skills"]);
    for (const result of [await board.retry(), await board.replace(), await board.setTick("~/.claude/skills", true)]) {
      assert.include(result.error, "--install-skills");
    }
    assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".agents")));
  });
});

describe("setTick", () => {
  it.effect("unticks a profile, removing its links, and ticks it back", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const { checks, board } = yield* launch(home);
      yield* checks.atLaunch;

      const off = yield* Effect.promise(() => board.setTick("~/.claude/skills", false));
      assert.strictEqual(off.error, undefined);
      assert.deepStrictEqual(off.removed, { links: ["lar-work"], checklists: false });
      assert.deepStrictEqual([target(off.snapshot, "~/.claude/skills")?.active, target(off.snapshot, "~/.claude/skills")?.selection], [false, "unticked"]);
      assert.isFalse(NodeFS.existsSync(link(home, ".claude")));

      const on = yield* Effect.promise(() => board.setTick("~/.claude-work/skills", true));
      assert.strictEqual(target(on.snapshot, "~/.claude-work/skills")?.active, true);
      assert.isTrue(NodeFS.lstatSync(link(home, ".claude-work")).isSymbolicLink());
    }));

  it.effect("returns the paths a tick left alone, from ~", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const { checks, board } = yield* launch(home);
      yield* checks.atLaunch;
      NodeFS.mkdirSync(link(home, ".claude-work"), { recursive: true });
      const result = yield* Effect.promise(() => board.setTick("~/.claude-work/skills", true));
      assert.deepStrictEqual(result.conflicts, ["~/.claude-work/skills/lar-work"]);
      assert.strictEqual(result.error, undefined);
    }));

  it.effect("refuses a path that isn't a listed target or a tick that isn't a boolean, and writes nothing", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const { checks, board } = yield* launch(home);
      yield* checks.atLaunch;
      const manifest = NodePath.join(home, ".agents/.lar-factory-install.json");
      const before = NodeFS.readFileSync(manifest, "utf8");
      NodeFS.mkdirSync(NodePath.join(home, "other"));
      for (const path of ["~/other", "../.claude/skills", NodePath.join(home, ".claude/skills"), "", 1, null]) {
        const result = yield* Effect.promise(() => board.setTick(path, false));
        assert.include(result.error, "is not an Install target", String(path));
      }
      const result = yield* Effect.promise(() => board.setTick("~/.claude/skills", "no"));
      assert.include(result.error, "true or false");
      assert.strictEqual(NodeFS.readFileSync(manifest, "utf8"), before);
      assert.isTrue(NodeFS.existsSync(link(home, ".claude")));
    }));

  it.effect("refuses to untick a locked target: one T3 requires, or ~/.agents/skills", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const answer = (): InstanceDiscovery => ({
        available: true,
        instances: [{ id: "claude", driver: "claudeAgent", displayName: "Claude", enabled: true, targets: installTargets("claudeAgent", home) }],
      });
      const { checks, board } = yield* launch(home, answer);
      yield* checks.afterDiscovery;
      for (const path of ["~/.claude/skills", "~/.agents/skills"]) {
        const result = yield* Effect.promise(() => board.setTick(path, false));
        assert.include(result.error, "stays ticked", path);
      }
      assert.isTrue(NodeFS.lstatSync(link(home, ".claude")).isSymbolicLink());
    }));

  it.effect("refuses a profile linked outside the install root, and writes nothing there", () =>
    Effect.gen(function* () {
      const home = makeHome();
      const outside = tempDir("board-outside-");
      NodeFS.symlinkSync(outside, NodePath.join(home, ".claude-elsewhere"));
      const { checks, board } = yield* launch(home, () => notRunning, home);
      yield* checks.atLaunch;
      const result = yield* Effect.promise(() => board.setTick("~/.claude-elsewhere/skills", true));
      assert.include(result.error, "outside the install root");
      assert.deepStrictEqual(NodeFS.readdirSync(outside), []);
    }));
});
