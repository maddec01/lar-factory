import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { BlockingPath } from "@lar-factory/shared/install-skills";

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

/** Runs a launch's check at launch, or before a build, if it makes one. */
const check = (input: SkillInstall.LaunchInput, at: keyof SkillInstall.Checks = "atLaunch") =>
  SkillInstall.makeChecks(input).pipe(Effect.flatMap((checks) => checks?.[at] ?? Effect.succeed(undefined)));

describe("oneAtATime", () => {
  it.live("runs two overlapping checks one after the other", () =>
    Effect.gen(function* () {
      let running = 0;
      const overlaps: Array<number> = [];
      const slow = Effect.gen(function* () {
        running += 1;
        overlaps.push(running);
        yield* Effect.sleep("20 millis");
        running -= 1;
      });
      const serial = yield* SkillInstall.oneAtATime;
      yield* Effect.all([serial(slow), serial(slow)], { concurrency: "unbounded" });
      assert.deepStrictEqual(overlaps, [1, 1]);
    }));
});

describe("makeChecks", () => {
  it.effect("installs with the Claude profile's links, then restores an edited skill on the next launch", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      NodeFS.mkdirSync(NodePath.join(home, ".claude"));
      const input = launch({ home, bundle: makeBundle() });

      const first = yield* check(input);
      assert.strictEqual(first?.installed, true);
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/references/checklist.md")));
      assert.isTrue(NodeFS.lstatSync(NodePath.join(home, ".claude/skills/lar-work")).isSymbolicLink());

      const second = yield* check(input);
      assert.strictEqual(second?.installed, false);

      NodeFS.writeFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "edited");
      const third = yield* check(input);
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

      const first = yield* check(input);
      assert.strictEqual(SkillInstall.notice(first!)?.type, "warning");
      const second = yield* check(input);
      assert.strictEqual(SkillInstall.notice(second!), undefined);
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(mine, "SKILL.md"), "utf8"), "mine");
    }));

  it.effect("leaves a blocking folder's dialog to the launch: a check before a build doesn't use it up", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const mine = NodePath.join(home, ".agents/skills/lar-work");
      NodeFS.mkdirSync(mine, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(mine, "SKILL.md"), "mine");
      NodeFS.writeFileSync(NodePath.join(home, ".agents/.lar-factory-install.json"), JSON.stringify({ version: "0.9.0", skills: [] }));
      const input = launch({ home, bundle: makeBundle() });

      const build = yield* check(input, "beforeBuild");
      assert.include(SkillInstall.buildRefusal(build!), mine);
      assert.strictEqual(SkillInstall.notice(build!)?.type, "warning");
      assert.strictEqual(SkillInstall.notice((yield* check(input, "beforeBuild"))!)?.type, "warning");
      assert.strictEqual(SkillInstall.notice((yield* check(input))!)?.type, "warning");
      assert.strictEqual(SkillInstall.notice((yield* check(input))!), undefined);
    }));

  it.effect("writes nothing on a dev run without the flag", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const result = yield* check(launch({ isPackaged: false, home, bundle: makeBundle() }));
      assert.strictEqual(result, undefined);
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".agents")));
    }));

  it.effect("fails with the engine's message, and the next launch retries", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const bundle = makeBundle();
      NodeFS.rmSync(NodePath.join(bundle, "references"), { recursive: true });

      const error = yield* Effect.flip(check(launch({ home, bundle })));
      assert.include(error.message, "references");
      assert.isFalse(error.changed);

      NodeFS.mkdirSync(NodePath.join(bundle, "references"));
      const retry = yield* check(launch({ home, bundle }));
      assert.strictEqual(retry?.installed, true);
    }));

  it.effect("names a manifest it can't read", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const manifest = NodePath.join(home, ".agents/.lar-factory-install.json");
      NodeFS.mkdirSync(NodePath.dirname(manifest));
      NodeFS.writeFileSync(manifest, "{ not json");

      const error = yield* Effect.flip(check(launch({ home, bundle: makeBundle() })));
      assert.include(error.message, manifest);
      assert.isFalse(error.changed);
    }));
});

describe("notice", () => {
  it("says nothing after a clean install", () => {
    assert.strictEqual(
      SkillInstall.notice({ installed: true, version: "1.0.0", skills: ["lar-work"], conflicts: [], blocked: [], warn: false }),
      undefined,
    );
  });

  const conflicted = { installed: false, version: "1.0.0", skills: [], conflicts: ["/home/.agents/skills/lar-work"],
    blocked: [{ skill: "lar-work", paths: [{ place: "agents" as const, path: "/home/.agents/skills/lar-work" }] }] };

  it("warns about conflicts and names each path", () => {
    const notice = SkillInstall.notice({ ...conflicted, warn: true });
    assert.strictEqual(notice?.type, "warning");
    assert.include(notice?.detail, "/home/.agents/skills/lar-work");
  });

  it("says nothing about conflicts an earlier launch of this version reported", () => {
    assert.strictEqual(SkillInstall.notice({ ...conflicted, warn: false }), undefined);
  });

  it("reports a failed install as an error that the next Start build or launch retries", () => {
    const notice = SkillInstall.notice(new SkillInstall.SkillInstallError({ message: "Couldn't copy references", changed: false }));
    assert.strictEqual(notice?.type, "error");
    assert.include(notice?.detail, "Couldn't copy references");
    assert.include(notice?.detail, "previous skills are still in place");
    assert.include(notice?.detail, "next Start build or launch");
  });

  it("says an install that stopped after replacing files stopped partway", () => {
    const notice = SkillInstall.notice(new SkillInstall.SkillInstallError({ message: "EACCES", changed: true }));
    assert.notInclude(notice?.detail, "still in place");
    assert.include(notice?.detail, "stopped partway");
    assert.include(notice?.detail, "next Start build or launch");
  });
});

describe("buildRefusal", () => {
  const clean = { installed: true, version: "1.0.0", skills: ["lar-work"], conflicts: [], blocked: [], warn: false };

  it("lets a build start once no skill is blocked, whatever the other conflicts", () => {
    assert.strictEqual(SkillInstall.buildRefusal(clean), null);
    assert.strictEqual(SkillInstall.buildRefusal({ ...clean, conflicts: ["/home/.claude/references"] }), null);
  });

  it("names each blocked skill, every path that blocks it and where each leaves it missing", () => {
    const paths: BlockingPath[] = [
      { place: "antigravity", path: "/home/.gemini/config/skills/tdd" }, { place: "profile", profile: ".claude", path: "/home/.claude/skills/tdd" },
    ];
    const refusal = SkillInstall.buildRefusal({
      ...clean, conflicts: [...paths.map(({ path }) => path), "/home/.agents/skills/grill"],
      blocked: [{ skill: "tdd", paths }, { skill: "grill", paths: [{ place: "agents", path: "/home/.agents/skills/grill" }] }],
    });
    assert.strictEqual(refusal, "The build can't start while a skill is blocked. " +
      "tdd is blocked by paths Lar Factory didn't install: /home/.gemini/config/skills/tdd (the skill isn't installed for Antigravity), " +
      "/home/.claude/skills/tdd (the skill isn't linked into ~/.claude; unticking the profile also clears it). " +
      "grill is blocked by a path Lar Factory didn't install: /home/.agents/skills/grill (the skill isn't installed). " +
      "Move each path away, then start the build again.");
  });

  it("says to move the one path away when only one blocks", () => {
    const refusal = SkillInstall.buildRefusal({ ...clean, blocked: [{ skill: "grill", paths: [{ place: "agents", path: "/home/.agents/skills/grill" }] }] });
    assert.match(refusal ?? "", /blocked by a path .* Move that path away/);
  });

  it("gives a failed restore's reason", () => {
    const refusal = SkillInstall.buildRefusal(new SkillInstall.SkillInstallError({ message: "EACCES: lar-work", changed: true }));
    assert.include(refusal, "couldn't restore");
    assert.include(refusal, "EACCES: lar-work");
  });
});
