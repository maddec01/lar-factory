# Checks

Input: recorded PR and approver recommendation. Output: current-head required
check results and handback Status, or a saved failure and retry count.

Set phase `checks`.

Call `watch_pull_request` on the PR; T3 wakes you when checks finish, someone
comments or the branch conflicts. Fast checks can finish first, so handle them
now and on every wake: read `gh pr checks <pr> --required`, or on Azure Repos
`az repos pr policy list --id <pr> --organization <org>`, where each policy
with `configuration.isBlocking` true is a required check whose `status` is
`approved` or `notApplicable` when green, `rejected` when failed, and `queued`
or `running` while it runs. Then:

- **Required checks green**: after failed Verify, return to **Verify** on this PR; only Pedro records the head-bound pass in the board. Status writes cannot replace it. Run `status.sh` now to set **Verify** or **Ready to merge** as recommended,
  `unwatch_pull_request`, end the turn. The board resumes this thread for
  [Retro](retro.md) only after the delivery PR is confirmed merged and the record is **Done**.
- **A required check failed, or the branch conflicts**: start a **CI fixer
  subagent** with [CI fixer](../agents/ci-fixer.md), the build's work ID, repo path, PR URL and
  the failing check (or "merge conflict"). The watch stays. If the fix or conflict resolution changed the final tree,
  obtain an updated Approver assessment of every listed check against that
  tree before handback. It records its own reuse reasons or reruns only checks
  it cannot justify, without restarting reviews or repeating unaffected checks.
  Then have the CI fixer update the PR's Checks section from the record and
  use the updated status recommendation. Then restart **Checks**.
- **Anything else** (checks running, a comment or review, a non-required check
  failing, a run cancelled by a newer run on the same head):
  end your turn only while required checks are pending. Non-required checks never block the status or start a fix.

Set **Needs you** when the CI fixer returns `infrastructure` or `not fixed`, or
a required check fails or the branch conflicts after two CI fixer runs (every
run counts, merge conflicts included). Tell the user the failing job's name
and run link (or "merge conflict") and the CI fixer's report,
`unwatch_pull_request`, and ask how to go on (rerun the job, start a CI
fixer, or stop). When they answer, set **Review**, do it, `watch_pull_request`
and restart **Checks**. If they say stop, set **Needs you** and end the turn.
