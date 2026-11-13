# Review

Input: integrated branch and passing validation record. Output: `review-rounds`,
fixed/rejected/open findings, unreviewed fixes and UI process ownership.

Set phase `review` and **Review**. Review runs in review rounds, at most two.

Round 1: in the build checkout, pin `head=$(git rev-parse HEAD)` and
`base=$(git merge-base origin/$base_branch "$head")`, then run
`lar-work select-reviewers <work ID> --base "$base" --head "$head"`.
Use its run/skip decisions and reasons, including uncertain matches. In
parallel, start one **reviewer subagent** for each selected reviewer, using
its returned instruction path (under the installed lar-build skill) or saved
instruction text. UI returns screenshot paths and an app report: the commit,
how to reach the app, and each process it started with a recheckable port or
other ownership evidence.

Give each only the prose rules, `<lar-build>/project-rules.md`,
`<lar-build>/shared/orchestration.md` with the instruction to apply **Wait for
delegated work**, its selected instructions, the build's work ID, the repo path and the
diff command `git diff <base SHA> <head SHA>` from selection. Note each reviewer you skip with a reason, and
say so in chat.

Give Code the selection too. For its `escalations`, rerun the same pinned selection with
`--escalations <json file>`; start each newly escalated reviewer once on that same diff,
before fixing findings. Never overrides requests. Copy each returned `escalation`
(requesting reviewer and reason) into that reviewer's round-1 record.

Each returns a verdict (`approve` or `changes`), findings and what it couldn't
check. Give each finding you reject a reason. Before handing the ones you
agree with to the [Fixer](../agents/fixer.md), note HEAD (`git rev-parse HEAD`) as this round's
base, and record the round with
`lar-work record-review-round <work ID> --revision N --file <json>`: the base,
each reviewer's verdict (`skipped`, with its reason as `notChecked`, for one
you skipped), what it couldn't check and its findings, each `open`, or
`rejected` with your reason. As the [Fixer](../agents/fixer.md) fixes one, mark it with
`lar-work set-disposition ... --disposition fixed`.

Round 2: rerun, in parallel, only the reviewers with a fixed finding. Give
each the prose rules, `<lar-build>/project-rules.md`,
`<lar-build>/shared/orchestration.md` with the instruction to apply **Wait for
delegated work**, its file's path, the build's work ID, the repo path, the
diff command `git diff <round base>..HEAD` (every fixup of round 1, not only
its own) and the list of its findings that were fixed; never the whole-branch
diff. The UI reviewer also gets round 1's app report, to reuse the app it left
running. Its findings stay within that fix diff. Reply to the ones you reject
as in round 1, record the round the same way, and hand the ones you agree
with to the [Fixer](../agents/fixer.md), with no further review. A finding you agree with that the [Fixer](../agents/fixer.md) leaves unfixed in either round
is still open after round 2, and goes to the approver for the PR body. A
reviewer's final result is its latest round's.

Review ends when round 1 fixed no finding, or after round 2. When review
ends, stop the processes listed in every UI app report of the build. Whoever
stops them, now or in a later thread, first confirms each one still holds
what its report names and stops only the ones that do.

On completion continue to [Approve](approve.md).
