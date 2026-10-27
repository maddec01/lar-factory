import { assert, describe, it } from "@effect/vitest";

import * as WindowBackground from "./window-background.ts";

describe("WindowBackground", () => {
  it("is the design system's background in light mode: zinc-25", () => {
    assert.equal(WindowBackground.color(false), "#fcfcfc");
  });

  it("is the design system's background in dark mode: neutral-950", () => {
    assert.equal(WindowBackground.color(true), "#0a0a0a");
  });
});
