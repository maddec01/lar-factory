# Start a build later

Ready means the current brief passed its gate. Shaping ends there and commits
the user to no implementation. Any later brief edit needs a fresh gate.
Tracker structure sync is independent of readiness and never starts a build.

The board's **Start build** on a Ready build is the user's Go. A build blocked by
other work starts only once that work is complete
([Completion](shared/issue-tracker/work-records.md#completion)), by hand or
through the board's **Start after**. With no repository project for the build's
repo, Start build stays disabled until the user adds the project in T3. Start
build:

1. records the project skills selected for the repository on the build's record,
   so later selections change only future builds;
2. sets a parent concept to In progress, where it stays until the concept is
   complete;
3. records a launch intent, so a restart finds the start instead of making a
   second thread;
4. starts the build thread in the build's repository project, in a new
   worktree on a branch named from the build's kind and title from the repository's resolved default or explicitly chosen PR target branch
   (`fix` for a `bug`, `feat` for a `feature` or `improvement`, else `chore`),
   with the message
   `Build <work ID>. Read <installed lar-build>/agents/builder.md and follow it.`,
   where `<installed lar-build>` is this skill's absolute path, and records the
   thread on the build. The build thread then archives the item's idle shaping
   threads (the builder's **Build** step 1).
