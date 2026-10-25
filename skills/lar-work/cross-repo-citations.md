# Cross-repository citations

When a commit message, PR title or PR body refers to work in another
repository, cite it this way:

- Cite the blocking `build` sub-issue of this build (a slice's parent build)
  that covers the work (`owner/repo#n`), open or closed.
- Cite that build's PR instead once one exists, open or merged. Find it with
  `gh issue view <n> -R <owner/repo> --json closedByPullRequestsReferences`.
- Never cite a commit SHA or a branch name. A rebase drops SHAs, and a branch
  can be renamed or deleted after merge.
- An implementer that finds no blocking build covering the work reports
  `needs <owner/repo>: <the work>` and cites nothing.
