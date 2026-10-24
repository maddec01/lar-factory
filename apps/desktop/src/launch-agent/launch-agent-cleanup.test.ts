import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as LaunchAgentCleanup from "./launch-agent-cleanup.ts";

const tempDir = (prefix: string) => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));

/** A home with the old agent's plist, pointing at a checkout that must stay. */
const makeHome = (withAgent: boolean) => {
  const home = tempDir("launch-agent-home-");
  const checkout = NodePath.join(home, "Code/mux-factory");
  NodeFS.mkdirSync(checkout, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(checkout, "README.md"), "# Mux factory\n");
  if (withAgent) {
    NodeFS.mkdirSync(NodePath.dirname(LaunchAgentCleanup.plistPath(home)), { recursive: true });
    NodeFS.writeFileSync(LaunchAgentCleanup.plistPath(home), `<plist><string>${checkout}</string></plist>\n`);
  }
  return { home, checkout };
};

/** A launchctl that writes its arguments to a log and exits with the given code. */
const makeLaunchctl = (exitCode: number) => {
  const dir = tempDir("fake-launchctl-");
  const log = NodePath.join(dir, "calls.log");
  const launchctl = NodePath.join(dir, "launchctl");
  NodeFS.writeFileSync(launchctl, `#!/bin/sh\necho "$@" >> "${log}"\nexit ${exitCode}\n`, { mode: 0o755 });
  const calls = () => (NodeFS.existsSync(log) ? NodeFS.readFileSync(log, "utf8").trim().split("\n") : []);
  return { launchctl, calls };
};

const run = (input: LaunchAgentCleanup.LaunchInput) =>
  LaunchAgentCleanup.onLaunch(input).pipe(Effect.provide(NodeServices.layer));

describe("onLaunch", () => {
  it.effect("boots the agent out of the user's GUI domain and deletes its plist", () =>
    Effect.gen(function* () {
      const { home, checkout } = makeHome(true);
      const fake = makeLaunchctl(0);
      yield* run({ isPackaged: true, home, uid: 501, launchctl: fake.launchctl });
      assert.deepStrictEqual(fake.calls(), ["bootout gui/501/nl.mux.factory-board"]);
      assert.isFalse(NodeFS.existsSync(LaunchAgentCleanup.plistPath(home)));
      assert.isTrue(NodeFS.existsSync(NodePath.join(checkout, "README.md")));
    }),
  );

  it.effect("calls nothing when the agent isn't there", () =>
    Effect.gen(function* () {
      const { home } = makeHome(false);
      const fake = makeLaunchctl(0);
      yield* run({ isPackaged: true, home, uid: 501, launchctl: fake.launchctl });
      assert.deepStrictEqual(fake.calls(), []);
    }),
  );

  it.effect("still deletes the plist when bootout fails", () =>
    Effect.gen(function* () {
      const { home, checkout } = makeHome(true);
      const fake = makeLaunchctl(3);
      yield* run({ isPackaged: true, home, uid: 501, launchctl: fake.launchctl });
      assert.lengthOf(fake.calls(), 1);
      assert.isFalse(NodeFS.existsSync(LaunchAgentCleanup.plistPath(home)));
      assert.isTrue(NodeFS.existsSync(NodePath.join(checkout, "README.md")));
    }),
  );

  it.effect("succeeds when launchctl can't run", () =>
    Effect.gen(function* () {
      const { home } = makeHome(true);
      yield* run({ isPackaged: true, home, uid: 501, launchctl: "/nonexistent/launchctl" });
      assert.isFalse(NodeFS.existsSync(LaunchAgentCleanup.plistPath(home)));
    }),
  );

  it.effect("leaves the agent alone in a dev run", () =>
    Effect.gen(function* () {
      const { home } = makeHome(true);
      const fake = makeLaunchctl(0);
      yield* run({ isPackaged: false, home, uid: 501, launchctl: fake.launchctl });
      assert.deepStrictEqual(fake.calls(), []);
      assert.isTrue(NodeFS.existsSync(LaunchAgentCleanup.plistPath(home)));
    }),
  );
});
