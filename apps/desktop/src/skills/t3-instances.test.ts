import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { tempDir } from "../../test/support.ts";
import * as T3Instances from "./t3-instances.ts";

/** A PATH whose `t3` prints its arguments and exits with `code`. */
const fakeT3 = (code: number) => {
  const bin = tempDir("fake-t3-");
  NodeFS.writeFileSync(NodePath.join(bin, "t3"), `#!/bin/sh\necho "$@"\nexit ${code}\n`, { mode: 0o755 });
  return { PATH: bin };
};

describe("runT3", () => {
  it.live("runs t3 from the given PATH and gives its output and exit code", () =>
    Effect.gen(function* () {
      const run = T3Instances.runT3(fakeT3(0));
      const answer = yield* Effect.promise(() => run(["auth", "session"], new AbortController().signal));
      assert.deepStrictEqual(answer, { code: 0, stdout: "auth session\n" });
      const failed = yield* Effect.promise(() => T3Instances.runT3(fakeT3(3))([], new AbortController().signal));
      assert.strictEqual(failed.code, 3);
    }));

  it.live("answers a null code when t3 isn't on the PATH", () =>
    Effect.gen(function* () {
      const answer = yield* Effect.promise(() => T3Instances.runT3({ PATH: tempDir("no-t3-") })([], new AbortController().signal));
      assert.strictEqual(answer.code, null);
    }));
});

describe("discover", () => {
  it("reads T3's runtime file from T3_SERVER_RUNTIME, or from T3's userdata folder in the home", () => {
    assert.strictEqual(T3Instances.runtimePath({ T3_SERVER_RUNTIME: "/tmp/runtime.json" }, "/Users/me"), "/tmp/runtime.json");
    assert.strictEqual(T3Instances.runtimePath({}, "/Users/me"), "/Users/me/.t3/userdata/server-runtime.json");
  });

  it.live("answers that T3 isn't running when its runtime file is missing", () =>
    Effect.gen(function* () {
      const dir = tempDir("t3-runtime-");
      const answer = yield* T3Instances.discover({ T3_SERVER_RUNTIME: NodePath.join(dir, "missing.json"), PATH: dir }, dir)(dir);
      assert.deepStrictEqual(answer, { available: false, reason: "not-running" });
    }));
});
