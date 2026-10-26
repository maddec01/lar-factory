import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeBundle, tempDir } from "../../test/support.ts";
import * as SkillInstall from "./skill-install.ts";

const launch = (overrides: Partial<SkillInstall.LaunchInput> = {}): SkillInstall.LaunchInput => ({
  isPackaged: true,
  version: "1.0.0",
  home: "/Users/someone",
  bundle: "/App/bundle",
  argv: [],
  env: {},
  ...overrides,
});

describe("locateBundle", () => {
  it("finds the bundle the build copies into dist-electron/ in development", () => {
    assert.strictEqual(SkillInstall.locateBundle("/repo/app", false), "/repo/app/dist-electron/bundle");
  });

  it("finds the bundle in the packaged app's Resources, outside app.asar", () => {
    assert.strictEqual(
      SkillInstall.locateBundle("/Applications/Board.app/Contents/Resources/app.asar", true),
      "/Applications/Board.app/Contents/Resources/bundle",
    );
  });
});

describe("plan", () => {
  it("installs a packaged app's bundle into the user's home", () => {
    assert.deepStrictEqual(SkillInstall.plan(launch()), {
      home: "/Users/someone",
      bundle: "/App/bundle",
      version: "1.0.0",
    });
  });

  it("installs into the root the environment overrides", () => {
    const plan = SkillInstall.plan(launch({ env: { [SkillInstall.ROOT_ENV]: "/tmp/home" } }));
    assert.strictEqual(plan?.home, "/tmp/home");
  });

  it("skips a dev run without the flag", () => {
    assert.strictEqual(SkillInstall.plan(launch({ isPackaged: false })), undefined);
  });

  it("installs a dev run with the flag into the overridden root", () => {
    const plan = SkillInstall.plan(launch({
      isPackaged: false,
      argv: ["/path/electron", ".", SkillInstall.INSTALL_FLAG],
      env: { [SkillInstall.ROOT_ENV]: "/tmp/home" },
    }));
    assert.deepStrictEqual(plan, { home: "/tmp/home", bundle: "/App/bundle", version: "1.0.0" });
  });
});

describe("onLaunch", () => {
  it.effect("installs with the Claude profile's links, then restores an edited skill on the next launch", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      NodeFS.mkdirSync(NodePath.join(home, ".claude"));
      const input = launch({ home, bundle: makeBundle() });

      const first = yield* SkillInstall.onLaunch(input);
      assert.strictEqual(first?.installed, true);
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/references/checklist.md")));
      assert.isTrue(NodeFS.lstatSync(NodePath.join(home, ".claude/skills/lar-work")).isSymbolicLink());

      const second = yield* SkillInstall.onLaunch(input);
      assert.strictEqual(second?.installed, false);

      NodeFS.writeFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "edited");
      const third = yield* SkillInstall.onLaunch(input);
      assert.strictEqual(third?.installed, true);
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "utf8"), "# lar-work\n");
    }));

  it.effect("shows a blocking folder's dialog on the first launch of a version, not the next", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const mine = NodePath.join(home, ".agents/skills/lar-work");
      NodeFS.mkdirSync(mine, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(mine, "SKILL.md"), "mine");
      NodeFS.writeFileSync(NodePath.join(home, ".agents/.lar-factory-install.json"), JSON.stringify({ version: "0.9.0", skills: [] }));
      const input = launch({ home, bundle: makeBundle() });

      const first = yield* SkillInstall.onLaunch(input);
      assert.strictEqual(SkillInstall.notice(first!)?.type, "warning");
      const second = yield* SkillInstall.onLaunch(input);
      assert.strictEqual(SkillInstall.notice(second!), undefined);
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(mine, "SKILL.md"), "utf8"), "mine");
    }));

  it.effect("writes nothing on a dev run without the flag", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const result = yield* SkillInstall.onLaunch(launch({ isPackaged: false, home, bundle: makeBundle() }));
      assert.strictEqual(result, undefined);
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".agents")));
    }));

  it.effect("fails with the engine's message, and the next launch retries", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const bundle = makeBundle();
      NodeFS.rmSync(NodePath.join(bundle, "references"), { recursive: true });

      const error = yield* Effect.flip(SkillInstall.onLaunch(launch({ home, bundle })));
      assert.include(error.message, "references");
      assert.isFalse(error.changed);

      NodeFS.mkdirSync(NodePath.join(bundle, "references"));
      const retry = yield* SkillInstall.onLaunch(launch({ home, bundle }));
      assert.strictEqual(retry?.installed, true);
    }));

  it.effect("names a manifest it can't read", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const manifest = NodePath.join(home, ".agents/.lar-factory-install.json");
      NodeFS.mkdirSync(NodePath.dirname(manifest));
      NodeFS.writeFileSync(manifest, "{ not json");

      const error = yield* Effect.flip(SkillInstall.onLaunch(launch({ home, bundle: makeBundle() })));
      assert.include(error.message, manifest);
      assert.isFalse(error.changed);
    }));
});

describe("notice", () => {
  it("says nothing after a clean install", () => {
    assert.strictEqual(
      SkillInstall.notice({ installed: true, version: "1.0.0", skills: ["lar-work"], conflicts: [], warn: false }),
      undefined,
    );
  });

  const conflicted = { installed: false, version: "1.0.0", skills: [], conflicts: ["/home/.agents/skills/lar-work"] };

  it("warns about conflicts and names each path", () => {
    const notice = SkillInstall.notice({ ...conflicted, warn: true });
    assert.strictEqual(notice?.type, "warning");
    assert.include(notice?.detail, "/home/.agents/skills/lar-work");
  });

  it("says nothing about conflicts an earlier launch of this version reported", () => {
    assert.strictEqual(SkillInstall.notice({ ...conflicted, warn: false }), undefined);
  });

  it("reports a failed install as an error that the next launch retries", () => {
    const notice = SkillInstall.notice(new SkillInstall.SkillInstallError({ message: "Couldn't copy references", changed: false }));
    assert.strictEqual(notice?.type, "error");
    assert.include(notice?.detail, "Couldn't copy references");
    assert.include(notice?.detail, "previous skills are still in place");
    assert.include(notice?.detail, "next launch");
  });

  it("says an install that stopped after replacing files stopped partway", () => {
    const notice = SkillInstall.notice(new SkillInstall.SkillInstallError({ message: "EACCES", changed: true }));
    assert.notInclude(notice?.detail, "still in place");
    assert.include(notice?.detail, "stopped partway");
    assert.include(notice?.detail, "next launch");
  });
});
