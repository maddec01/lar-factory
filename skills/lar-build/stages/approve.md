# Approve

Input: final reviews, validation, rejected/open findings and unreviewed fixes.
Output: recorded PR, assessment and recommendation, or a saved delivery hold.

Start the **Approver subagent** with [Approver](../agents/approver.md),
`<lar-build>/project-rules.md`, the build's work ID, the repo path, every reviewer's final result,
your rejected findings, the findings still
open after round 2, the unreviewed fixes, the **Domain docs added by the
build** list, resolved domain-doc setting/paths and the out-of-scope notes. An unreviewed fix is a round-2 fix;
list each as a line naming the finding, its severity and its reviewer. It opens
the PR and returns a recommended status; the item stays in Review. Record the
PR on the build (`lar-work set-pr <work ID> --revision N --pr <owner/repo#n>`)
and link it to this thread (`link_pull_request`).
When the approver reports a rebase conflict or a failing check instead, hand
it to the [Fixer](../agents/fixer.md); for a conflict, the [Fixer](../agents/fixer.md) rebases onto `origin/$base_branch` and
resolves it. Add the fix to the unreviewed fixes, then start the approver
again. When it reports that the PR can't be delivered (no push access to the
branch or fork, or a PR rule only the user can meet), set **Needs you**, tell
the user what blocks it and what would unblock it, and ask how to go on; the
record keeps the brief and the branch keeps the commits. After two restarts
for a conflict or check, set **Needs you**, tell the user the conflict or
failing check, and ask how to go on.

On completion continue to [Ci](ci.md).
