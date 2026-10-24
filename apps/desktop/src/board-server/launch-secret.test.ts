import { assert, describe, it } from "@effect/vitest";

import * as LaunchSecret from "./launch-secret.ts";

describe("LaunchSecret", () => {
  it("makes a new secret each launch", () => {
    const first = LaunchSecret.make();
    assert.match(first, /^[\w-]{43}$/);
    assert.notStrictEqual(LaunchSecret.make(), first);
  });

  it("hands the secret to the board's pages", () => {
    assert.strictEqual(LaunchSecret.forFrame("http://127.0.0.1:4318/?view=list", "http://127.0.0.1:4318", "s3cret"), "s3cret");
  });

  it("hands no secret to a page of another origin or one that doesn't parse", () => {
    for (const frameUrl of ["http://127.0.0.1:4319/", "https://github.com/", "data:text/html,starting", ""]) {
      assert.isNull(LaunchSecret.forFrame(frameUrl, "http://127.0.0.1:4318", "s3cret"), frameUrl);
    }
  });

  it("hands no secret while no board server is ready", () => {
    for (const frameUrl of ["http://127.0.0.1:4318/", "data:text/html,starting", "about:blank", ""]) {
      assert.isNull(LaunchSecret.forFrame(frameUrl, "", "s3cret"), frameUrl);
    }
  });
});
