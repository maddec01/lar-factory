import { assert, describe, it } from "@effect/vitest";

import * as WindowTitleBar from "./WindowTitleBar.ts";

describe("WindowTitleBar", () => {
  it("on a Mac, hides the title bar and centres the traffic lights in the page's 52 px bar", () => {
    assert.deepStrictEqual(WindowTitleBar.options("darwin"), {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 19 },
    });
  });

  it("elsewhere, keeps the system's title bar", () => {
    assert.deepStrictEqual(WindowTitleBar.options("linux"), {});
  });
});
