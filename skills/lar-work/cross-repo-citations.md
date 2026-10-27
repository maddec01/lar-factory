# Cross-repository citations

When a commit message, PR title or PR body refers to work in another
repository, cite it this way:

- Cite the blocking `build` sub-issue of this build (a slice's parent build)
  that covers the work (`owner/repo#n`), open or closed.
- Cite that build's PR instead once one exists, open or merged. Find it with
  `gh issue view <n> -R <owner/repo> --json closedByPullRequestsReferences`.
- On Azure DevOps cite the work item's URL, then its PR's. The work item's
  `Pull Request` links name each PR as
  `vstfs:///Git/PullRequestId/<project id>%2F<repo id>%2F<PR id>`:
  `az boards work-item show --id <id> --expand relations --organization <org> --query "relations[?attributes.name=='Pull Request'].url"`.
  The PR's web URL is its `repository.webUrl` from
  `az repos pr show --id <PR id> --organization <org>`, then `/pullrequest/<PR id>`.
- Never cite a commit SHA or a branch name. A rebase drops SHAs, and a branch
  can be renamed or deleted after merge.
- An implementer that finds no blocking build covering the work reports
  `needs <owner/repo>: <the work>` and cites nothing.
