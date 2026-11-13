# Full checks

Input: integrated branch and project rules. Output: saved check list, complete
passing validation and diagnosed failures, or a saved missing-check hold.

A check subagent reads `<lar-build>/project-rules.md#validation-record` and saves the
   applicable checks with `lar-work set-check-list <work ID> --file <file>`.
   The JSON list contains each command and folder, selected from project rules
   and the diff, leaving out suites the diff cannot reach. It runs every listed
   check for real once on the integrated branch through `run-check`, reusing
   only results from the identical tree. It names failures before retries.
   You own every open failure and make one diagnosis attempt, through the
   Fixer when helpful. The Fixer reruns the failed check after a fix; it does
   not repeat unrelated suites. Close failures with their cause or fix.
   All checks must pass; an unexplained failure that later passed stays open.

   An interrupted or unfinished run leaves its check missing, never passed or
   failed. After the check subagent reports, read `lar-work checks <work ID>`.
   Once its runs have ended, start one new check subagent for the missing
   checks, or for this whole step if no list was saved. If anything is still
   missing, set **Needs you**, naming it and recommending one more run over
   waiting while the user looks into it. Then continue from this step.
Run [Remove worktrees](remove-worktrees.md), then push the branch.
Continue to [Review](review.md); the approver opens the PR.
