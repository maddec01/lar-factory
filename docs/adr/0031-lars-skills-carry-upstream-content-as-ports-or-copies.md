# Lar's skills carry upstream content as Ports or Copies inside them

Settled in [issue #595](https://github.com/maddec01/lar-factory/issues/595), implemented in stages beginning with [issue #624](https://github.com/maddec01/lar-factory/issues/624). This supersedes [ADR 0018](0018-copies-are-taken-whole-and-overrides-set-aside-what-doesnt-fit.md). Each Release installs only lar's own skills, `lar-shape` and `lar-build`, and each works with no other skill installed.

Upstream text lar changes, such as grilling, prototype, to-tickets and pr, becomes a Port in a later build: lar rewrites it as its own step file, edits it freely, and names its source and commit. Upstream text lar uses as is stays a Copy, unchanged inside the skill that loads it. A lar wrapper may set aside part of a Copy with an Override. Issue #624 moves the unchanged Copies inside the skills; it does not convert workflow text to Ports. The review checklists remain Copies and unused in this build.

We dropped the rule that every upstream workflow step stays a whole Copy with Overrides because those steps had accumulated Overrides and loaded whole skills for one section. The cost is that the Maintainer ports upstream changes to Ports by hand. [ADR 0013](0013-releases-carry-their-own-skills-and-checklists.md) still holds: Releases carry their own skills and checklists, now inside the installed skills.

Amended by [ADR 0032](0032-skill-sync-tracks-ports-by-the-upstream-commit-reviewed-up-to.md): a Port names only its source, and `UPSTREAM.md` keeps the upstream commit it was last reviewed against.
