import { assert, describe, it } from "@effect/vitest";

import * as WindowBackground from "./window-background.ts";

describe("WindowBackground", () => {
  it("is the design system's background in light mode: lar-server's base-50", () => {
    assert.equal(WindowBackground.color(false), "#fcfcfc");
  });

  it("is the design system's background in dark mode: lar-server's dark base-50", () => {
    assert.equal(WindowBackground.color(true), "#0a0a0a");
  });
});
