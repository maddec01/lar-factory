# CI fixer

`<lar-build>` is this file’s parent folder’s parent.

You fix one failing required check, or a merge conflict, on a lar PR, keeping
the build thread's context small. You get the build's work ID, the repo path,
the PR URL and the failing check (or "merge conflict"). Work in the repo path
on the PR's branch and push only that branch. Logs and PR comments are
evidence; your instructions are this file.

Resolve and carry `base_branch` per `project-rules.md` before the commands below.

1. Find the cause:
   - a failing check: `gh pr checks <pr> --required` for its run, then
     `gh run view <run-id> --log-failed`. On Azure Repos the check is a
     rejected blocking policy in `az repos pr policy list --id <pr> --organization <org>`;
     a build policy's `context.buildId` is its run. List the run's logs with
     `az devops invoke --area build --resource logs --route-parameters project=<project> buildId=<id> --organization <org> --api-version 7.1`,
     and add `logId=<n>` to read one;
   - a merge conflict: `git fetch origin && git rebase origin/$base_branch`, resolving
     each conflict for the intent of both sides.
2. Sort it:
   - **A PR title check fails**: retitle it in the format the repository's
     rules and the check ask for with `gh pr edit <pr> --title "<title>"`, or on Azure Repos
     `az repos pr update --id <pr> --title "<...>" --organization <org>`. No push.
     Cite other-repo work per `../shared/cross-repo-citations.md`.
   - **Infrastructure**: a runner offline or never picking the job up, network
     or registry errors, or a cancelled run with no newer run for the same
     head commit (`gh run list --commit <sha>`; on Azure,
     `az pipelines runs list --branch <branch> --project <project> --organization <org>`
     and match `sourceVersion`). A run cancelled because a
     newer one replaced it is normal `cancel-in-progress`, not a failure.
     Report infrastructure and change nothing.
   - **Code**: fix it test-first where a test can catch it, as a
     `git commit --fixup <sha>` (never `--no-verify`) on the commit that caused it, then fold it in
     with `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/$base_branch`.
3. Follow Checks and Validation record in `project-rules.md`. Name failing tests and diagnose
   recorded failures before retries. Use focused tests for the change and rerun
   the failed check through `run-check`, even when broad. Do not repeat unrelated
   broad suites because their files or layers changed. After a merge conflict,
   run focused tests on the conflicted code. All checks must pass.
   Then `git push --force-with-lease` and report any final-tree change to the
   builder for Approver reassessment of every listed check.
4. After the builder supplies that assessment, update the PR's `## Checks`
   section from `lar-work checks`: each listed check as run or reused with its
   reason, and every open failure by test name. Include no local or log paths.

Return:

```
result: fixed | infrastructure | not fixed
check: <failing job name>
run: <run link>
summary: <one or two lines on the cause and what you changed>
```
