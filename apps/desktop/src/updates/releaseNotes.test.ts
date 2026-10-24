import { assert, describe, it } from "@effect/vitest";

import { normalizeReleaseNotes } from "./releaseNotes.ts";

/** A Release body as GitHub's generated notes write it: a "What's Changed" list of PR titles, oldest first. */
const body = (...titles: string[]) =>
  [
    "## What's Changed",
    ...titles.map((title, i) => `* ${title} by @maddec01 in https://github.com/maddec01/mux-factory/pull/${i + 1}`),
    "",
    "**Full Changelog**: https://github.com/maddec01/mux-factory/compare/v0.1.0...v0.2.0",
  ].join("\n");

const titles = (count: number, prefix = "feat(board): change") =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

describe("normalizeReleaseNotes", () => {
  it("gives each Release between the running version and the new one its changes, newest first", () => {
    const notes = normalizeReleaseNotes(
      [
        { version: "0.4.0", note: body("feat(board): show the changelog", "fix(board): keep the header steady") },
        { version: "0.3.0", note: body("<b>refactor</b>(board): split the &amp; store") },
        { version: "0.2.0", note: "## What's Changed\n\n**Full Changelog**: https://x/compare/a...b" },
      ],
      "0.4.0",
      "latest",
    );
    assert.deepStrictEqual(notes, {
      releaseNotes: [
        {
          version: "0.4.0",
          items: [
            "fix(board): keep the header steady by @maddec01 in https://github.com/maddec01/mux-factory/pull/2",
            "feat(board): show the changelog by @maddec01 in https://github.com/maddec01/mux-factory/pull/1",
          ],
          totalItems: 2,
        },
        {
          version: "0.3.0",
          items: ["refactor(board): split the & store by @maddec01 in https://github.com/maddec01/mux-factory/pull/1"],
          totalItems: 1,
        },
      ],
      omittedReleaseCount: 0,
    });
  });

  it("keeps the newest 8 changes of a Release and counts them all", () => {
    const { releaseNotes } = normalizeReleaseNotes([{ version: "0.2.0", note: body(...titles(11)) }], "0.2.0", "latest");
    assert.strictEqual(releaseNotes[0]!.totalItems, 11);
    assert.deepStrictEqual(
      releaseNotes[0]!.items.map((item) => item.split(" by ")[0]),
      titles(11).slice(3).toReversed(),
    );
  });

  it("keeps 6 Releases and counts the rest as omitted", () => {
    const releases = Array.from({ length: 9 }, (_, i) => ({ version: `0.${10 - i}.0`, note: body(`fix: ${i}`) }));
    const { releaseNotes, omittedReleaseCount } = normalizeReleaseNotes(releases, "0.10.0", "latest");
    assert.deepStrictEqual(
      releaseNotes.map((note) => note.version),
      ["0.10.0", "0.9.0", "0.8.0", "0.7.0", "0.6.0", "0.5.0"],
    );
    assert.strictEqual(omittedReleaseCount, 3);
  });

  it("keeps the nightly channel's Releases on nightly and the stable ones on latest", () => {
    const releases = [
      { version: "0.3.0-nightly.20261024.52", note: body("feat: nightly two") },
      { version: "0.3.0", note: body("feat: stable") },
      { version: "0.2.0-nightly.20261023.51", note: body("feat: nightly one") },
    ];
    const versions = (channel: "latest" | "nightly") =>
      normalizeReleaseNotes(releases, "x", channel).releaseNotes.map((note) => note.version);
    assert.deepStrictEqual(versions("nightly"), ["0.3.0-nightly.20261024.52", "0.2.0-nightly.20261023.51"]);
    assert.deepStrictEqual(versions("latest"), ["0.3.0"]);
  });

  it("reads a single body as the new version's notes, and ignores notes it can't read", () => {
    const single = normalizeReleaseNotes(body("fix: one"), "0.2.0", "latest");
    assert.deepStrictEqual(single.releaseNotes.map((note) => note.version), ["0.2.0"]);
    assert.deepStrictEqual(normalizeReleaseNotes(null, "0.2.0", "latest"), { releaseNotes: [], omittedReleaseCount: 0 });
    assert.deepStrictEqual(normalizeReleaseNotes([{ version: 2 }], "0.2.0", "latest").releaseNotes, []);
  });
});
