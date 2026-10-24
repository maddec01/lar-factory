import { assert, describe, it } from "@effect/vitest";

import * as ExternalLink from "./ExternalLink.ts";

describe("ExternalLink", () => {
  it("opens web links in the browser", () => {
    assert.strictEqual(ExternalLink.browserUrl("https://github.com/maddec01/mux-factory/issues/203"), "https://github.com/maddec01/mux-factory/issues/203");
    assert.strictEqual(ExternalLink.browserUrl("http://example.com"), "http://example.com/");
  });

  it("opens nothing for other schemes or a URL that doesn't parse", () => {
    for (const target of ["file:///etc/passwd", "javascript:alert(1)", "smb://host/share", "x-apple.systempreferences:", "not a url", ""]) {
      assert.isUndefined(ExternalLink.browserUrl(target), target);
    }
  });

  it("keeps the board's own pages in the window", () => {
    assert.isTrue(ExternalLink.isOn("http://127.0.0.1:4318/?view=list", "http://127.0.0.1:4318"));
    assert.isFalse(ExternalLink.isOn("http://127.0.0.1:4319/", "http://127.0.0.1:4318"));
    assert.isFalse(ExternalLink.isOn("not a url", "http://127.0.0.1:4318"));
  });
});
