import { assert, describe, it } from "@effect/vitest";

import * as StartingPage from "./starting-page.ts";

const html = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1));

describe("StartingPage", () => {
  it("says the board is starting", () => {
    const page = StartingPage.url();
    assert.match(page, /^data:text\/html;charset=utf-8,/);
    assert.include(html(page), "Starting board…");
    assert.notInclude(html(page), "didn't start");
  });

  it("shows why the last start failed, escaped", () => {
    const page = html(StartingPage.url("the board server exited with code 1 <before> it reported a port"));
    assert.include(page, "The board server didn't start: the board server exited with code 1 &#60;before&#62; it reported a port. Trying again.");
  });
});
