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
