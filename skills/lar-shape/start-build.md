# 5. Start the build


The board's **Start build** on a Ready build is the user's Go. A build blocked by
another issue starts only once that issue closes, by hand or through the
board's **Start after**. With no repository project for the build's repo,
Start build stays disabled until the user adds the project in T3. Start build:

1. adds the `build` label (a tag on Azure DevOps), so the board shows the build's sub-issues as slices;
2. sets a parent that isn't a build to In progress, where it stays until a
   build's PR closes it ([Parent closing](shared/issue-tracker/parent-closing.md#parent-closing));
3. starts the build thread in the build's repository project, in a new
   worktree on branch `<kind>/<n>-<slug>` from `main` (`fix` for a `bug`,
   `feat` for a `feature` or `improvement`, else `chore`), with the message
   `Build <owner/repo>#<n>. Read <installed lar-build>/agents/builder.md and follow it.`,
   where `<installed lar-build>` is this skill's absolute path. The build
   thread then archives the issue's idle shaping threads (the builder's
   **Build** step 1).
