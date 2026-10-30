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
  it.effect("installs with the Claude profile's links, then reports an edited skill as Drift on the next launch and leaves it", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      NodeFS.mkdirSync(NodePath.join(home, ".claude"));
      const input = launch({ home, bundle: makeBundle() });

      const first = yield* check(input);
      assert.strictEqual(first?.installed, true);
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".agents/references/checklist.md")));
      assert.isTrue(NodeFS.lstatSync(NodePath.join(home, ".claude/skills/lar-work")).isSymbolicLink());

      const second = yield* check(input);
      assert.strictEqual(second?.installed, false);

      NodeFS.writeFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "edited");
      const third = yield* check(input, "beforeBuild");
      assert.strictEqual(third?.installed, false);
      assert.deepStrictEqual(third?.drift.map(({ skill }) => skill), ["lar-work"]);
      assert.strictEqual(SkillInstall.buildRefusal(third!), null);
      assert.include(SkillInstall.notice(third!)?.detail, NodePath.join(home, ".agents/skills/lar-work"));
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "utf8"), "edited");
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
      NodeFS.rmSync(NodePath.join(bundle, "skills"), { recursive: true });

      const error = yield* Effect.flip(check(launch({ home, bundle })));
      assert.include(error.message, "skills");
      assert.isFalse(error.changed);

      NodeFS.mkdirSync(NodePath.join(bundle, "skills/lar-work"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(bundle, "skills/lar-work/SKILL.md"), "# lar-work\n");
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

describe("requiredTargets", () => {
  it("gives every instance's targets, disabled ones too, once per path and required", () => {
    const agents = { kind: "agents" as const, path: "/home/.agents/skills" };
    const custom = { kind: "claude" as const, path: "/work/claude/skills" };
    const instances: Array<ProviderInstance> = [
      { id: "codex", driver: "codex", displayName: "Codex", enabled: true, targets: [agents] },
      { id: "cursor", driver: "cursor", displayName: "Cursor", enabled: false, targets: [agents] },
      { id: "work", driver: "claudeAgent", displayName: "Work", enabled: false, targets: [custom] },
    ];
    assert.deepStrictEqual(SkillInstall.requiredTargets(instances), [{ ...agents, required: true }, { ...custom, required: true }]);
  });
});

describe("makeChecks with T3", () => {
  it.effect("installs into the fallback targets at launch without waiting for T3", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      NodeFS.mkdirSync(NodePath.join(home, ".claude"));
      const made = yield* checks(launch({ home, bundle: makeBundle() }), () => Effect.never);

      const outcome = yield* made.atLaunch;
      assert.strictEqual(outcome.installed, true);
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md")));
      assert.isTrue(NodeFS.lstatSync(NodePath.join(home, ".claude/skills/lar-work")).isSymbolicLink());
    }));

  it.effect("installs into the targets T3 reports once it answers, and leaves the existing ones as they are", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const work = NodePath.join(home, "work-claude");
      NodeFS.mkdirSync(work);
      let answer: InstanceDiscovery = { available: false, reason: "timed-out" };
      const made = yield* checks(launch({ home, bundle: makeBundle() }), asking(() => answer));
      yield* made.atLaunch;
      assert.strictEqual(yield* made.afterDiscovery, undefined);
      NodeFS.writeFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "edited");

      answer = answering([{ kind: "claude", path: NodePath.join(work, "skills") }]);
      const found = yield* made.afterDiscovery;
      assert.isTrue(NodeFS.lstatSync(NodePath.join(work, "skills/lar-work")).isSymbolicLink());
      assert.strictEqual(read(NodePath.join(work, "skills/lar-work/SKILL.md")), "edited");
      assert.deepStrictEqual(found?.drift.map(({ skill }) => skill), ["lar-work"]);
      const target = found?.targets.find(({ path }) => path === NodePath.join(work, "skills"));
      assert.deepStrictEqual([target?.required, target?.active, target?.finished], [true, true, true]);
    }));

  it.live("keeps asking a T3 that timed out until it answers, then installs its new targets and leaves the others", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const work = NodePath.join(home, "work-claude");
      NodeFS.mkdirSync(work);
      let asked = 0;
      const made = yield* checks(launch({ home, bundle: makeBundle() }), asking(() =>
        ++asked < 3 ? { available: false, reason: "timed-out" } : answering([{ kind: "claude", path: NodePath.join(work, "skills") }])));
      yield* made.atLaunch;
      NodeFS.writeFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "edited");

      yield* SkillInstall.discoverUntilAnswered(made, "5 millis");

      assert.strictEqual(asked, 3);
      assert.strictEqual(made.state().discovery, "available");
      assert.isTrue(NodeFS.lstatSync(NodePath.join(work, "skills/lar-work")).isSymbolicLink());
      assert.strictEqual(read(NodePath.join(home, ".agents/skills/lar-work/SKILL.md")), "edited");
    }));

  it.effect("keeps T3's targets through a later outage", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const work = NodePath.join(home, "work-claude");
      NodeFS.mkdirSync(work);
      let answer = answering([{ kind: "claude", path: NodePath.join(work, "skills") }]);
      const made = yield* checks(launch({ home, bundle: makeBundle() }), asking(() => answer));
      yield* made.afterDiscovery;

      answer = { available: false, reason: "unauthenticated" };
      NodeFS.rmSync(NodePath.join(work, "skills/lar-work"));
      const build = yield* made.beforeBuild();
      const target = build.targets.find(({ path }) => path === NodePath.join(work, "skills"));
      assert.deepStrictEqual([target?.required, target?.active], [true, true]);
      assert.deepStrictEqual(build.drift.map(({ paths }) => paths.map(({ path }) => path)), [[NodePath.join(work, "skills/lar-work")]]);
    }));

  it.effect("installs into a Claude home the User unticked once T3 requires it", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      NodeFS.mkdirSync(NodePath.join(home, ".claude"));
      let answer: InstanceDiscovery = { available: false, reason: "not-running" };
      const made = yield* checks(launch({ home, bundle: makeBundle() }), asking(() => answer));
      yield* made.atLaunch;
      setTargetTick(home, NodePath.join(home, ".claude/skills"), false);
      yield* made.atLaunch;
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".claude/skills/lar-work")));

      answer = answering([{ kind: "claude", path: NodePath.join(home, ".claude/skills") }]);
      yield* made.afterDiscovery;
      assert.isTrue(NodeFS.lstatSync(NodePath.join(home, ".claude/skills/lar-work")).isSymbolicLink());
    }));

  it.effect("refuses Start build for a T3 target the install failed in, but not for a T3 outage alone", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      NodeFS.writeFileSync(NodePath.join(home, "gemini"), "a file, not a folder");
      const broken = NodePath.join(home, "gemini/skills");
      let answer: InstanceDiscovery = { available: false, reason: "timed-out" };
      const made = yield* checks(launch({ home, bundle: makeBundle() }), asking(() => answer));
      assert.strictEqual(SkillInstall.buildRefusal(yield* made.beforeBuild()), null);

      answer = answering([{ kind: "antigravity", path: broken }]);
      const refusal = SkillInstall.buildRefusal(yield* made.beforeBuild());
      assert.include(refusal, `${broken}: `);
    }));

  it.effect("on a new Release with T3 down, removes obsolete skills from migrated Antigravity copies no fallback target offers", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const folders = [".gemini/config/skills", ".gemini/antigravity-cli/skills"];
      for (const folder of [".agents/skills", ...folders]) {
        for (const skill of ["lar-work", "old"]) {
          NodeFS.mkdirSync(NodePath.join(home, folder, skill), { recursive: true });
          NodeFS.writeFileSync(NodePath.join(home, folder, skill, "SKILL.md"), `${skill} 0.9`);
        }
      }
      NodeFS.mkdirSync(NodePath.join(home, ".gemini/config/skills/mine"));
      NodeFS.writeFileSync(NodePath.join(home, ".agents/.lar-factory-install.json"), JSON.stringify({
        version: "0.9.0", skills: ["lar-work", "old"], antigravity: Object.fromEntries(folders.map((folder) => [folder, ["lar-work", "old"]])),
      }));
      const made = yield* checks(launch({ home, bundle: makeBundle() }), outage);

      const outcome = yield* made.atLaunch;
      assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(home, ".agents/skills")), ["lar-work"]);
      assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(home, folders[0]!)).sort(), ["lar-work", "mine"]);
      assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(home, folders[1]!)), ["lar-work"]);
      assert.strictEqual(SkillInstall.buildRefusal(outcome), null);
    }));

  it.effect("runs a launch check and a build check that start together one after the other", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const made = yield* checks(launch({ home, bundle: makeBundle() }), outage);
      const [launched, built] = yield* Effect.all([made.atLaunch, made.beforeBuild()], { concurrency: "unbounded" });
      assert.deepStrictEqual([launched.installed, built.installed], [true, false]);
    }));
});

describe("buildAnswer", () => {
  const clean = { installed: false, version: "1.0.0", skills: ["lar-work"], conflicts: [], blocked: [], drift: [], replaced: [], warn: false, targets: [] };
  const drift = [{ skill: "tdd", paths: [{ place: "agents" as const, path: "/home/.agents/skills/tdd" }, { place: "agents" as const, path: "/work/skills/tdd" }] },
    { skill: "grill", paths: [{ place: "agents" as const, path: "/home/.agents/skills/grill" }] }];

  it("lets a build without Drift start, whatever the choice", () => {
    assert.deepStrictEqual(SkillInstall.buildAnswer(clean), { refusal: null });
  });

  const conflicted = { installed: false, version: "1.0.0", skills: [], conflicts: ["/home/.agents/skills/lar-work"],
    blocked: [{ skill: "lar-work", paths: [{ place: "agents" as const, path: "/home/.agents/skills/lar-work" }] }], drift: [], replaced: [], targets: [] };

  it("warns about conflicts and names each path", () => {
    const notice = SkillInstall.notice({ ...conflicted, warn: true });
    assert.strictEqual(notice?.type, "warning");
    assert.include(notice?.detail, "/home/.agents/skills/lar-work");
  });

  it("says nothing about conflicts an earlier launch of this version reported", () => {
    assert.strictEqual(SkillInstall.notice({ ...conflicted, warn: false }), undefined);
  });

  it("warns about Drift on every launch and names each skill's paths", () => {
    const drift = [{ skill: "tdd", paths: [{ place: "agents" as const, path: "/home/.agents/skills/tdd" }] }];
    const notice = SkillInstall.notice({ ...conflicted, conflicts: [], blocked: [], drift, warn: false });
    assert.strictEqual(notice?.message, "Some of Lar Factory's skills changed");
    assert.include(notice?.detail, "tdd: /home/.agents/skills/tdd");
  });

  it("reports a failed install as an error that the next Start build or launch retries", () => {
    const notice = SkillInstall.notice(new SkillInstall.SkillInstallError({ message: "Couldn't copy references", changed: false }));
    assert.strictEqual(notice?.type, "error");
    assert.include(notice?.detail, "Couldn't copy references");
    assert.include(notice?.detail, "previous skills are still in place");
    assert.include(notice?.detail, "next Start build or launch");
  });

  it("names each target an install failed in as an error", () => {
    const failed = { kind: "antigravity" as const, path: "/home/.gemini/config/skills", paths: [], required: false, active: true, finished: false, error: { message: "EACCES", changed: false } };
    const notice = SkillInstall.notice({ ...conflicted, conflicts: [], blocked: [], warn: false, targets: [failed] });
    assert.strictEqual(notice?.type, "error");
    assert.include(notice?.detail, "/home/.gemini/config/skills: EACCES");
  });

  it("says an install that stopped after replacing files stopped partway", () => {
    const notice = SkillInstall.notice(new SkillInstall.SkillInstallError({ message: "EACCES", changed: true }));
    assert.notInclude(notice?.detail, "still in place");
    assert.include(notice?.detail, "stopped partway");
    assert.include(notice?.detail, "next Start build or launch");
  });
});

describe("buildRefusal", () => {
  const clean = { installed: true, version: "1.0.0", skills: ["lar-work"], conflicts: [], blocked: [], drift: [], replaced: [], warn: false, targets: [] };

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

  it("lets a build start with Drift", () => {
    assert.strictEqual(SkillInstall.buildRefusal({ ...clean, drift: [{ skill: "tdd", paths: [{ place: "agents", path: "/home/.agents/skills/tdd" }] }] }), null);
  });

  it("names each target the install failed in, even with Drift alone", () => {
    const failed = { kind: "claude" as const, path: "/home/.claude/skills", paths: [], required: true, active: true, finished: false, error: { message: "EACCES", changed: true } };
    const refusal = SkillInstall.buildRefusal({ ...clean, targets: [failed], drift: [{ skill: "tdd", paths: [{ place: "agents", path: "/home/.agents/skills/tdd" }] }] });
    assert.include(refusal, "couldn't install");
    assert.include(refusal, "/home/.claude/skills: EACCES");
  });

  it("gives a failed install's reason", () => {
    const refusal = SkillInstall.buildRefusal(new SkillInstall.SkillInstallError({ message: "EACCES: lar-work", changed: true }));
    assert.include(refusal, "couldn't install");
    assert.include(refusal, "EACCES: lar-work");
  });
});
