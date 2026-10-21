# Slices are sub-issues merged into the build branch

[Issue #35](https://github.com/maddec01/mux-factory/issues/35) settled, over
grilling [round 1](https://github.com/maddec01/mux-factory/issues/35#issuecomment-6326984285),
[rounds 2–3](https://github.com/maddec01/mux-factory/issues/35#issuecomment-6327155861)
and [round 4](https://github.com/maddec01/mux-factory/issues/35#issuecomment-6327423563),
that a build's slices are native sub-issues of its build issue. Each is built
by one implementer subagent in its own worktree and fast-forwarded into the
build branch; a slice never gets its own PR, branch on origin or board Status.
A PR per slice would give smaller reviews and independent merges, but each
would need Pedro's review and merge ([ADR 0002](0002-pedro-merges-every-pr.md))
and its own status, which defeats one issue in, one PR out, hands-off.
