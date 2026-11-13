# Build handoff

Input: current phase, branch, slices, checks and task ownership. Output: saved
handoff and continuation on the same work record and build worktree.

Past about 150k tokens, while work before the PR step remains, start no new
implementers or planners, wait for any running planner to return (a native
subagent outlives a handoff), and merge or `task_cancel` every running
child task: task IDs work only in the thread that created them, so the
handoff carries none. Then write a handoff per
`<lar-build>/shared/handoff.md` and relaunch with `t3_thread_launch`:
message `Build <work ID>. Read <lar-build>/agents/builder.md and follow it.`
followed by the handoff,
`workspaceStrategy` `{"type":"existing_worktree","worktreePath":"<build worktree>","branch":"<build branch>"}`.
The handoff names the step and review round to resume at. For a Small build
it says `Small build` and whether the change is done, so the next thread skips
**Plan** instead of reading no slices as not planned. It carries the
**Domain docs added by the build**
list and the latest [Remove worktrees](remove-worktrees.md) lines. At a review round,
`lar-work review-rounds` already holds each round's base, verdicts and findings; the handoff adds the unreviewed fixes so far,
each as the line [Approve](approve.md) describes, and every UI app report so far,
whose processes the next thread stops when review ends. Otherwise finish in
place.
