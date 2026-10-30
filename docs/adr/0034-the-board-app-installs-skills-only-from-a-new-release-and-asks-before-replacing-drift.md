# The board app installs skills only from a new Release and asks before replacing Drift

Settled in [#593's decision](https://github.com/maddec01/lar-factory/issues/593#issuecomment-6501685880). This supersedes [ADR 0021](0021-the-board-app-restores-installed-skills-that-differ-from-the-release.md)'s silent restore; [ADR 0013](0013-releases-carry-their-own-skills-and-checklists.md) stands.

The board app writes lar's skills into an agent only when the installed Release differs from the one its manifest last recorded, or into a target it hasn't installed into yet. At launch and before each Start build it looks for Drift and offers to replace it, but never replaces it on its own; a new Release overwrites Drift and lists it. We chose this so installed skills change with the Release unless the User explicitly replaces Drift. The cost is that a build can run on a skill the User edited if they choose Start anyway.
