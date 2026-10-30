import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { setTargetTick, type BlockingPath } from "@lar-factory/shared/install-skills";
import type { InstallTarget, InstanceDiscovery, ProviderInstance } from "@lar-factory/shared/install-targets";

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

  it("installs into the root the environment overrides, and keeps every write inside it", () => {
    const plan = SkillInstall.plan(launch({ env: { [SkillInstall.ROOT_ENV]: "/tmp/home" } }));
    assert.deepStrictEqual([plan?.home, plan?.root], ["/tmp/home", "/tmp/home"]);
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
    assert.deepStrictEqual(plan, { home: "/tmp/home", root: "/tmp/home", bundle: "/App/bundle", version: "1.0.0" });
  });
});

/** A T3 that isn't running. */
const outage: SkillInstall.Discover = () => Effect.succeed({ available: false, reason: "not-running" });

/** A T3 that answers with one instance per list of targets, in the order given. */
const answering = (...targets: Array<Array<InstallTarget>>): InstanceDiscovery => ({
  available: true,
  instances: targets.map((list, index): ProviderInstance => ({ id: `i${index}`, driver: "claudeAgent", displayName: `I${index}`, enabled: true, targets: list })),
});

/** A T3 whose answer `answer()` gives at each ask, so a test can change it between checks. */
const asking = (answer: () => InstanceDiscovery): SkillInstall.Discover => () => Effect.sync(answer);

/** Runs a launch's check at launch, or before a build, if it makes one, with T3 not running. */
const check = (input: SkillInstall.LaunchInput, at: "atLaunch" | "beforeBuild" = "atLaunch") =>
  SkillInstall.makeChecks(input, outage).pipe(Effect.flatMap((checks) =>
    (at === "atLaunch" ? checks?.atLaunch : checks?.beforeBuild()) ?? Effect.succeed(undefined)));

/** This launch's checks, which a packaged launch always makes. */
const checks = (input: SkillInstall.LaunchInput, discover: SkillInstall.Discover) =>
  SkillInstall.makeChecks(input, discover).pipe(Effect.map((made) => made!));

const read = (path: string) => NodeFS.readFileSync(path, "utf8");

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
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md"), "utf8"), "edited");
    }));

  it.effect("asks before a build with Drift: Start anyway leaves the files, Replace and start overwrites them", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const made = yield* checks(launch({ home, bundle: makeBundle() }), outage);
      yield* made.atLaunch;
      const skill = NodePath.join(home, ".agents/skills/lar-work/SKILL.md");
      const bundled = read(skill);
      NodeFS.writeFileSync(skill, "edited");

      const asked = SkillInstall.buildAnswer(yield* made.beforeBuild());
      assert.deepStrictEqual(asked.drift, ["lar-work"]);
      assert.include(asked.refusal, "lar-work");
      assert.strictEqual(read(skill), "edited");

      assert.deepStrictEqual(SkillInstall.buildAnswer(yield* made.beforeBuild("keep"), "keep"), { refusal: null });
      assert.strictEqual(read(skill), "edited");

      const replaced = yield* made.beforeBuild("replace");
      assert.deepStrictEqual(SkillInstall.buildAnswer(replaced, "replace"), { refusal: null });
      assert.deepStrictEqual(replaced.replaced, ["lar-work"]);
      assert.strictEqual(read(skill), bundled);
    }));

  it.effect("refuses the build when Replace and start can't replace the Drift, and says why", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const made = yield* checks(launch({ home, bundle: makeBundle() }), outage);
      yield* made.atLaunch;
      const skills = NodePath.join(home, ".agents/skills");
      NodeFS.writeFileSync(NodePath.join(skills, "lar-work/SKILL.md"), "edited");
      NodeFS.chmodSync(skills, 0o555);
      const outcome = yield* made.beforeBuild("replace").pipe(Effect.catch(Effect.succeed));
      NodeFS.chmodSync(skills, 0o755);
      const answer = SkillInstall.buildAnswer(outcome, "replace");
      assert.include(answer.refusal, "couldn't replace");
      assert.strictEqual(answer.drift, undefined);
    }));

  it.effect("with an install root, leaves a Claude home linked outside it alone and refuses the build", () =>
    Effect.gen(function* () {
      const root = tempDir("skill-root-");
      const outside = tempDir("skill-outside-");
      NodeFS.symlinkSync(outside, NodePath.join(root, ".claude"));
      const input = launch({ home: "/Users/someone", bundle: makeBundle(), env: { [SkillInstall.ROOT_ENV]: root } });

      const outcome = yield* check(input, "beforeBuild");
      assert.deepStrictEqual(NodeFS.readdirSync(outside), []);
      assert.isTrue(NodeFS.existsSync(NodePath.join(root, ".agents/skills/lar-work/SKILL.md")));
      assert.include(SkillInstall.buildRefusal(outcome!), "outside the install root");
    }));

  it.effect("leaves a blocking folder alone and reports it on every check, for the page's notice", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const mine = NodePath.join(home, ".agents/skills/lar-work");
      NodeFS.mkdirSync(mine, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(mine, "SKILL.md"), "mine");
      NodeFS.writeFileSync(NodePath.join(home, ".agents/.lar-factory-install.json"), JSON.stringify({ version: "0.9.0", skills: [] }));
      const input = launch({ home, bundle: makeBundle() });

      const build = yield* check(input, "beforeBuild");
      assert.include(SkillInstall.buildRefusal(build!), mine);
      for (const outcome of [build, yield* check(input), yield* check(input)]) {
        assert.deepStrictEqual(outcome?.blocked.map(({ skill, paths }) => [skill, paths.map(({ path }) => path)]), [["lar-work", [mine]]]);
      }
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(mine, "SKILL.md"), "utf8"), "mine");
    }));

  it.effect("writes nothing on a dev run without the flag", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const result = yield* check(launch({ isPackaged: false, home, bundle: makeBundle() }));
      assert.strictEqual(result, undefined);
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, ".agents")));
    }));

  it.effect("installs the checkout's skills on a dev run with the flag", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      const result = yield* check(launch({ isPackaged: false, argv: ["/path/electron", ".", SkillInstall.INSTALL_FLAG], home, bundle: makeBundle() }));
      assert.strictEqual(result?.installed, true);
      assert.isTrue(NodeFS.existsSync(NodePath.join(home, ".agents/skills/lar-work/SKILL.md")));
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

  it.effect("after a restart with T3 down, keeps installing into T3's recorded targets and refuses a build on their Clash", () =>
    Effect.gen(function* () {
      const home = NodeFS.realpathSync(tempDir("skill-home-"));
      const work = NodePath.join(home, "work-claude");
      NodeFS.mkdirSync(work);
      const before = yield* checks(launch({ home, bundle: makeBundle() }), asking(() => answering([{ kind: "claude", path: NodePath.join(work, "skills") }])));
      yield* before.afterDiscovery;
      NodeFS.rmSync(NodePath.join(work, "skills/lar-work"));
      NodeFS.mkdirSync(NodePath.join(work, "skills/lar-work"));

      const after = yield* checks(launch({ home, bundle: makeBundle(), version: "2.0.0" }), outage);
      const target = after.state().targets.find(({ path }) => path === NodePath.join(work, "skills"));
      assert.deepStrictEqual(target, { kind: "claude", path: NodePath.join(work, "skills"), required: true });
      const outcome = yield* after.atLaunch;
      const checked = outcome.targets.find(({ paths }) => paths.includes(NodePath.join(work, "skills")));
      assert.deepStrictEqual([checked?.required, checked?.active], [true, true]);
      assert.include(SkillInstall.buildRefusal(outcome), NodePath.join(work, "skills/lar-work"));
    }));

  it.effect("asks T3 on every Start build and retry, and reuses only an answer T3 gave for the Drift choice and Replace", () =>
    Effect.gen(function* () {
      const home = tempDir("skill-home-");
      let asked = 0;
      let answer: InstanceDiscovery = { available: false, reason: "timed-out" };
      const made = yield* checks(launch({ home, bundle: makeBundle() }), asking(() => (asked += 1, answer)));

      // T3 didn't answer, so the Drift choice, Replace and a retry each ask again.
      yield* made.beforeBuild();
      yield* made.beforeBuild("replace");
      yield* made.replace;
      yield* made.retry;
      assert.strictEqual(asked, 4);

      // T3 answered: the Drift choice and Replace reuse it, while a Start build and a retry ask again.
      answer = answering([]);
      yield* made.beforeBuild();
      yield* made.beforeBuild("keep");
      yield* made.replace;
      assert.strictEqual(asked, 5);
      yield* made.retry;
      yield* made.beforeBuild();
      assert.strictEqual(asked, 7);
      yield* made.afterDiscovery;
      assert.strictEqual(asked, 8);
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

  it("asks for a choice, naming each skill with Drift once", () => {
    const answer = SkillInstall.buildAnswer({ ...clean, drift });
    assert.deepStrictEqual(answer.drift, ["tdd", "grill"]);
    assert.include(answer.refusal, "tdd and grill");
  });

  it("starts anyway with Drift when the User chose to", () => {
    assert.deepStrictEqual(SkillInstall.buildAnswer({ ...clean, drift }, "keep"), { refusal: null });
  });

  it("refuses when Drift is left after Replace and start", () => {
    const answer = SkillInstall.buildAnswer({ ...clean, drift }, "replace");
    assert.include(answer.refusal, "couldn't replace");
    assert.strictEqual(answer.drift, undefined);
  });

  it("never offers Start anyway for a Clash or a failed install", () => {
    const blocked = [{ skill: "grill", paths: [{ place: "agents" as const, path: "/home/.agents/skills/grill" }] }];
    const failed = { kind: "claude" as const, path: "/home/.claude/skills", paths: [], required: true, skills: [], active: true, finished: false, error: { message: "EACCES", changed: true } };
    for (const outcome of [{ ...clean, drift, blocked }, { ...clean, drift, targets: [failed] }, new SkillInstall.SkillInstallError({ message: "EACCES", changed: false })]) {
      for (const choice of [undefined, "keep" as const]) {
        const answer = SkillInstall.buildAnswer(outcome, choice);
        assert.isString(answer.refusal);
        assert.strictEqual(answer.drift, undefined);
      }
    }
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
    const failed = { kind: "claude" as const, path: "/home/.claude/skills", paths: [], required: true, skills: [], active: true, finished: false, error: { message: "EACCES", changed: true } };
    const refusal = SkillInstall.buildRefusal({ ...clean, targets: [failed], drift: [{ skill: "tdd", paths: [{ place: "agents", path: "/home/.agents/skills/tdd" }] }] });
    assert.include(refusal, "couldn't install");
    assert.include(refusal, "/home/.claude/skills: EACCES");
  });

  it("says a failed Replace and start couldn't replace the skills", () => {
    const refusal = SkillInstall.buildRefusal(new SkillInstall.SkillInstallError({ message: "EACCES: lar-work", changed: true }), "replace");
    assert.include(refusal, "couldn't replace");
    assert.include(refusal, "EACCES: lar-work");
  });

  it("gives a failed install's reason", () => {
    const refusal = SkillInstall.buildRefusal(new SkillInstall.SkillInstallError({ message: "EACCES: lar-work", changed: true }));
    assert.include(refusal, "couldn't install");
    assert.include(refusal, "EACCES: lar-work");
  });
});
