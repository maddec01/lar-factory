# Review

Input: integrated branch and passing validation record. Output: `review-rounds`,
fixed/rejected/open findings, unreviewed fixes and UI process ownership.

At most two rounds.

Round 1: in the build checkout, pin `head=$(git rev-parse HEAD)` and
`base=$(git merge-base origin/$base_branch "$head")`, then run
`lar-work select-reviewers <work ID> --base "$base" --head "$head"`.
With a supplied run ID, add `--run-id RUN_ID`. Use returned decisions/reasons,
including uncertain matches; report skips in chat. In parallel, start each
selected reviewer with its returned instruction path (under installed lar-build)
or frozen text, work ID, repo path, `<lar-build>/project-rules.md`, saved domain-doc
setting/paths and `<lar-build>/shared/orchestration.md`, including its report and
**Wait for delegated work** rules. Supply `git diff <base SHA> <head SHA>`.
UI returns screenshot paths and an app report: commit, access instructions and
each started process with recheckable ownership evidence such as its port.

Give Code the selection. For its `escalations`, repeat the pinned selection with
`--escalations <json file>`; launch each newly selected reviewer once on the same
diff before fixing. `never` wins. Preserve each returned `escalation` (requester
and reason) in that reviewer's round-1 record.

Each returns verdict (`approve` or `changes`), findings and not-checked evidence.
Explain rejected findings. Before assigning accepted findings to the
[Fixer](../agents/fixer.md), save HEAD as the round base and call
`lar-work record-review-round <work ID> --revision N --file <json>` with base,
runId when supplied, reviewer verdicts, findings and optional `notChecked` text.
The command fills each reviewer's selection/escalation and skip reason from the
saved `select-reviewers` result; omit unchecked notes when none (`""` is accepted).
Example: `{"base":"<saved HEAD>","reviewers":[{"axis":"code","verdict":"approve","findings":[]}]}`.
Record every reviewer that ran; configured skips are filled automatically. Findings are `open`,
or `rejected` with reason. Mark fixes with `lar-work set-disposition ... --disposition fixed`.

Round 2: rerun only reviewers with fixed findings, in parallel, with the same
inputs/instructions, their fixed findings and `git diff <round base>..HEAD`:
every round-1 fix, never the whole branch. UI also gets its earlier app report
for reuse. Findings stay within that fix diff. Reject, record and fix as above;
no further review. Accepted unfixed findings stay open. Send them and round-2
fixes (unreviewed) to Approve; each reviewer's latest round is its final result.

End after round 1 if nothing was fixed, otherwise after round 2. Stop every
reported UI process only after confirming it still holds its ownership evidence,
even when a later thread does the cleanup. Continue to [Approve](approve.md).
