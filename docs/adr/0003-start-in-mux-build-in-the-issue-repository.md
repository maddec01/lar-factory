# Start in Mux; build in the issue repository

[Issue #9's confirmed brief](https://github.com/maddec01/mux-factory/issues/9)
places board Start in the shared Mux project: it launches a thread with
`/mux-work owner/repo#n`, as implemented in
[commit 3fef010](https://github.com/maddec01/mux-factory/commit/3fef0103641afe76bc954916e473cfeb5e215900)
and described in the [board instructions](../../board/README.md).
The current [mux-work workflow](../../skills/mux-work/SKILL.md#1-pick-up)
shapes an issue when needed, or proceeds directly from a passing brief to
[launching a separate build](../../skills/mux-work/SKILL.md#5-start-the-build)
in the issue repository's project and its own worktree; Start itself leaves
status changes to mux-work.
The agreement explicitly covers concepts spanning repositories through a map
and one build sub-issue per repository; the benefit of shared planning context
with separate build workspaces is an inference from that arrangement, not a
recorded historical rationale or comparison of alternatives.
