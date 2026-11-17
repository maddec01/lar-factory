# Remove worktrees

Input: finished slices and implement-thread ownership/activity. Output: each
script result, including reasons for kept worktrees.

A pass covers every finished slice of the build (`lar-work children <work ID>`
with `finishedAt` set) and each of its implement threads
(`lar-work threads <slice>` with purpose `implement`). For each thread, gather
T3's facts:

- **Path.** `worktreePath` from `t3_thread_read`, with `limit` 1. Use an empty
  path when T3 can't read the thread.
- **Activity.** `inactive` when `activeRunId` is null, `pendingRequestCount` is
  0 and no running thread descends from it. Find those with `t3_thread_list`,
  using `allProjects`, `includeSubagents` and the statuses `preparing`, `queued`,
  `starting`, `running` and `waiting`, reading every page through `nextCursor`,
  and follow each result's `parentThreadId` up to this thread. Otherwise pass the
  reason, such as `T3 shows an active run` or `T3 is unavailable`. A page that
  fails counts as `T3 is unavailable`.

Then run the script from the build worktree:

```sh
bash <lar-build>/shared/scripts/remove-slice-worktree.sh <build work ID> <slice work ID> <thread ID> <build worktree> "<path>" "<activity>"
```

The script makes every other check and does the removal. Write each line it
prints in this thread. A kept worktree leaves the build running and its status
unchanged, and each later pass retries it. Done when every implement thread of
every finished slice has had its run.

## Merged delivery cleanup

Humans merge. After observing a provider-confirmed merge, the board cleans the
recorded delivery branch and build worktree, retrying after active work ends,
using the existing work-cleanup ownership checks and provider-confirmed merged
head. Leave the build worktree clean and end the turn so it can proceed. Read the work record's exact buildBranch, the thread's worktree binding,
the merged PR's head and current T3 activity first. Never derive a deletion target
from review text. Only remove a clean, registered, owned worktree below the
trusted T3/project worktree root; never the main checkout, a symlink, a dirty tree,
a changed branch/head, or one used by another active thread/child. Do not force
removal or discard local changes. A squash/rebase merge can leave a non-ancestor
local branch: only delete it after proving its exact head equals the merged PR
head, and after its worktree is gone. Delete the remote source branch only if
its current SHA still equals that merged head; a moved branch is retained.
If T3 still holds the active worktree, the board retains it until T3 reports
that binding inactive; never delete underneath it. Report every kept target and why; never call
retained work "removed". A closed, unmerged PR never authorizes this cleanup.
