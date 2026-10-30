import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { installSkills, setProfileTick } from "@lar-factory/shared/install-skills";
import { makeBundle, tempDir } from "../../test/support.ts";
import * as ClaudeProfiles from "./claude-profiles.ts";

/** A throwaway home with two Claude profiles, ~/.claude and the ticked .claude-work, and the bundle's skill installed. */
const makeHome = (install = true) => {
  const home = tempDir("profiles-home-");
  NodeFS.mkdirSync(NodePath.join(home, ".claude"));
  NodeFS.mkdirSync(NodePath.join(home, ".claude-work"));
  if (install) {
    installSkills(home, makeBundle(), "1.0.0");
    setProfileTick(home, ".claude-work", true);
  }
  return home;
};

const link = (home: string, profile: string) => NodePath.join(home, profile, "skills/lar-work");

describe("list", () => {
  it("lists every profile with its tick", () => {
    const home = makeHome();
    assert.deepStrictEqual(ClaudeProfiles.list(home), {
      profiles: [{ name: ".claude", ticked: true }, { name: ".claude-work", ticked: true }],
      installed: true,
      conflicts: [],
    });
  });

  it("says when no skills are installed yet", () => {
    assert.isFalse(ClaudeProfiles.list(makeHome(false)).installed);
  });

  it("returns an error naming a manifest it can't read", () => {
    const home = makeHome();
    const manifest = NodePath.join(home, ".agents/.lar-factory-install.json");
    NodeFS.writeFileSync(manifest, "{ not json");
    const result = ClaudeProfiles.list(home);
    assert.include(result.error, "Couldn't read ~/.agents/.lar-factory-install.json:");
    assert.notInclude(result.error, home);
    assert.deepStrictEqual(result.profiles, []);
  });
});

describe("fromBoard", () => {
  it("accepts only a frame on the board's origin", () => {
    const board = "http://127.0.0.1:4319";
    assert.isTrue(ClaudeProfiles.fromBoard("http://127.0.0.1:4319/?view=all", board));
    assert.isFalse(ClaudeProfiles.fromBoard("http://127.0.0.1:4320/", board));
    assert.isFalse(ClaudeProfiles.fromBoard("https://example.com/", board));
    assert.isFalse(ClaudeProfiles.fromBoard(undefined, board));
    assert.isFalse(ClaudeProfiles.fromBoard("not a url", board));
    assert.isFalse(ClaudeProfiles.fromBoard("about:blank", ""));
  });
});

describe("setTick", () => {
  it("unticks a profile, removing its links, and ticks it back", () => {
    const home = makeHome();
    const off = ClaudeProfiles.setTick(home, ".claude-work", false);
    assert.deepStrictEqual(off.profiles, [{ name: ".claude", ticked: true }, { name: ".claude-work", ticked: false }]);
    assert.isFalse(NodeFS.existsSync(link(home, ".claude-work")));

    assert.deepStrictEqual(off.removed, { links: ["lar-work"], checklists: false });

    const on = ClaudeProfiles.setTick(home, ".claude-work", true);
    assert.deepStrictEqual(on.profiles[1], { name: ".claude-work", ticked: true });
    assert.isTrue(NodeFS.lstatSync(link(home, ".claude-work")).isSymbolicLink());
  });

  it("returns the paths a tick left alone", () => {
    const home = makeHome();
    ClaudeProfiles.setTick(home, ".claude-work", false);
    NodeFS.mkdirSync(link(home, ".claude-work"));
    const result = ClaudeProfiles.setTick(home, ".claude-work", true);
    assert.deepStrictEqual(result.conflicts, ["~/.claude-work/skills/lar-work"]);
    assert.strictEqual(result.error, undefined);
  });

  it("refuses names that aren't a Claude profile folder, and writes nothing", () => {
    const home = makeHome();
    NodeFS.mkdirSync(NodePath.join(home, "other"));
    for (const name of ["../other", ".claude/../other", "other", ".claude-a/b", "", 1, null]) {
      const result = ClaudeProfiles.setTick(home, name, false);
      assert.include(result.error, "not a Claude profile", String(name));
      assert.isTrue(NodeFS.existsSync(link(home, ".claude")));
    }
  });

  it("accepts every name the install engine lists as a profile", () => {
    const home = makeHome();
    NodeFS.mkdirSync(NodePath.join(home, ".claude-"));
    NodeFS.mkdirSync(NodePath.join(home, ".claude-my profile"));
    for (const name of [".claude-", ".claude-my profile"]) {
      const result = ClaudeProfiles.setTick(home, name, true);
      assert.strictEqual(result.error, undefined, name);
      assert.isTrue(NodeFS.lstatSync(link(home, name)).isSymbolicLink(), name);
    }
  });

  it("refuses a profile linked outside the install root, and writes nothing there", () => {
    const home = makeHome();
    const outside = tempDir("profiles-outside-");
    NodeFS.symlinkSync(outside, NodePath.join(home, ".claude-elsewhere"));
    const result = ClaudeProfiles.setTick(home, ".claude-elsewhere", true, home);
    assert.include(result.error, "outside the install root");
    assert.deepStrictEqual(NodeFS.readdirSync(outside), []);
  });

  it("refuses a profile the home doesn't have", () => {
    const result = ClaudeProfiles.setTick(makeHome(), ".claude-gone", true);
    assert.strictEqual(result.error, ".claude-gone is not a Claude profile in ~");
  });

  it("refuses a tick that isn't true or false", () => {
    const result = ClaudeProfiles.setTick(makeHome(), ".claude", "no");
    assert.include(result.error, "true or false");
  });

  it("says when no skills are installed yet", () => {
    const home = makeHome(false);
    const result = ClaudeProfiles.setTick(home, ".claude", false);
    assert.strictEqual(result.error, "No skills are installed in ~/.agents yet");
    assert.deepStrictEqual(result.profiles, [{ name: ".claude", ticked: true }, { name: ".claude-work", ticked: false }]);
  });
});
