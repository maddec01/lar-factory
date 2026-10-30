# skill-sync tracks Ports by the upstream commit reviewed up to

Amends [ADR 0031](0031-lars-skills-carry-upstream-content-as-ports-or-copies.md), settled in [issue #640](https://github.com/maddec01/lar-factory/issues/640).

`UPSTREAM.md` records each skill-text Port's upstream files, sections and commit in a Ports table, and the Port itself names only its source. The commit means "reviewed up to here" and moves forward when the Maintainer ports a change or skips it, unlike a Copy's commit, which means "matches". skill-sync shows each Port's whole upstream folder with the folded sections marked, and lists skills a source added since the last sync.

We kept the commit out of the Port's header so that it lives in one place, and we let skips move it so that changes lar doesn't need come back only once. The cost is that a skipped change is gone from later reports, so a wrong skip has to be caught by reading upstream's history.
