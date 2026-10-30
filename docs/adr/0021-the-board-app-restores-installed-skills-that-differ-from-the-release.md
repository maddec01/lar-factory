---
status: superseded by ADR-0034
---

# The board app restores installed skills that differ from the Release

Settled in [#357's decision](https://github.com/maddec01/lar-factory/issues/357#issuecomment-6416788601).

The board app compares each installed bundled skill with the Release's copy at start and before each build, and overwrites any that differ, with no merge. Every user then runs the skills the maintainer reviewed, and a build never runs an upstream change without its Override. A user's edit to an installed skill is lost; changes go through the maintainer's sync instead.

[ADR 0034](0034-the-board-app-installs-skills-only-from-a-new-release-and-asks-before-replacing-drift.md) supersedes this: the board app now asks before replacing Drift and writes skills only from a new Release.
