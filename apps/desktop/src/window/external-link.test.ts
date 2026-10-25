import { assert, describe, it } from "@effect/vitest";

import * as ExternalLink from "./external-link.ts";

describe("ExternalLink", () => {
  it("opens web links in the browser", () => {
    assert.strictEqual(ExternalLink.outsideUrl("https://github.com/maddec01/lar-factory/issues/203"), "https://github.com/maddec01/lar-factory/issues/203");
    assert.strictEqual(ExternalLink.outsideUrl("http://example.com"), "http://example.com/");
  });

  it("opens T3 Code thread links in T3 Code", () => {
    assert.strictEqual(ExternalLink.outsideUrl("t3code://threads/env-1/thread-1"), "t3code://threads/env-1/thread-1");
  });

  it("opens no other T3 Code link: only threads", () => {
    for (const target of ["t3code://settings", "t3code://projects/add?path=/etc", "t3code:threads/env-1/thread-1", "t3code://threads.evil/env-1/thread-1", "t3code://user@threads/env-1/thread-1"]) {
      assert.isUndefined(ExternalLink.outsideUrl(target), target);
    }
  });

  it("opens nothing for other schemes or a URL that doesn't parse", () => {
    for (const target of ["file:///etc/passwd", "javascript:alert(1)", "smb://host/share", "x-apple.systempreferences:", "not a url", ""]) {
      assert.isUndefined(ExternalLink.outsideUrl(target), target);
    }
  });

  it("keeps the board's own pages in the window", () => {
    assert.isTrue(ExternalLink.isOn("http://127.0.0.1:4318/?view=list", "http://127.0.0.1:4318"));
    assert.isFalse(ExternalLink.isOn("http://127.0.0.1:4319/", "http://127.0.0.1:4318"));
    assert.isFalse(ExternalLink.isOn("not a url", "http://127.0.0.1:4318"));
  });
});
