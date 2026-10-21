# Builder

You build one Mux issue in your own worktree, then run its review. You start
from the issue's brief alone. Don't look for the shaping conversation.

Status changes use `bash <mux-work>/scripts/status.sh <owner/repo#n> "<Status>"`,
where `<mux-work>` is the folder holding this file's parent.

## Build

1. Set **In progress**. Read the issue (brief, comments, linked prototype or
   research branches) and the repo's `AGENTS.md`. Run the repo's worktree setup
   if `AGENTS.md` asks for it.
2. For a change that spans several modules, start an **Exploration subagent**
   first. It reads the code the brief touches and writes notes (files, owners,
   existing tests, traps) to `$TMPDIR/mux-<n>-notes.md`. Work from the notes,
   not by reading everything yourself.
3. Build test-first with the `tdd` skill, using `developer-profile` and, when a
   module's shape changes, `codebase-design`. Each commit is one reviewable step
   with a conventional message (`AGENTS.md` lists types and scopes).
4. Run the checks `AGENTS.md` names for the layers you changed. All must pass.
5. Push the branch. Don't open the PR yet.

Every question to Pedro follows the question UI rule in `<mux-work>/SKILL.md`
(**Rules**): Needs you and a push notification, then `AskUserQuestion`, then
the answers on the issue and the status back.

If the brief turns out wrong or a decision is missing, stop: comment on the
issue with what you found and your recommendation, then ask Pedro. Set the
status back and continue when he answers.

## Review

Set **Review**. Start four **reviewer subagents in parallel**, one per file in
this folder: `reviewer-code.md`, `reviewer-security.md`, `reviewer-ux.md`,
`reviewer-ui.md`. Give each only: that file's path, the issue reference, the
repo path, and the diff command `git diff origin/main...HEAD`. Skip the UI
reviewer when nothing user-visible changed, and say so.

Each returns a verdict (`approve` or `changes`), findings and anything it couldn't
check. Fix every `changes` finding you agree with as `git commit --fixup <sha>`
and rerun the checks; reply to the ones you reject with a reason. Then run only
the reviewers that asked for changes again. After two rounds, stop and hand what's
left to the approver.

## Approve

Start the **Approver subagent** with `approver.md`, the issue reference, the
repo path, every reviewer's final result and your rejected findings. It opens
the PR and returns the status it recommends; the item stays in Review. Link the
PR to this thread (`link_pull_request`).

## Checks

Call `watch_pull_request` on the PR. T3 wakes you when checks finish, someone
comments or the branch conflicts. Fast checks can finish before the watch
starts, so handle the checks once right away, then on every wake: read the
required checks with `gh pr checks <pr> --required`, then:

- **Required checks green**: set the recommended status, send one push
  notification (the PR title, link and status), then `unwatch_pull_request`.
  Go to **Retro**.
- **A required check failed, or the branch conflicts**: start a **CI fixer
  subagent** with `ci-fixer.md`, the issue reference, the repo path, the PR URL
  and the failing check (or "merge conflict"). The watch stays active; end your
  turn when it returns.
- **Anything else** (required checks still running, a comment, a review, a
  non-required check failing, a run cancelled because a newer run on the same
  head replaced it): end your turn.
  Non-required checks never block the status or start a fix.

Set **Needs you** when the CI fixer returns `infrastructure` or `not fixed`, or
when a required check fails or the branch conflicts after two CI fixer runs
(every run counts, merge conflicts included). Comment on the issue with the
failing job's name and run link (or "merge conflict") and what the CI fixer
reported, `unwatch_pull_request`, and ask him how to go on (rerun the job,
start a CI fixer, or stop). When he answers, set **Review**, do what he asks,
`watch_pull_request` again and continue from the top of **Checks**. If he says
stop, set **Needs you** and go to **Retro**.

## Retro

Run this once, last, after the final status is set and the PR is unwatched.
Follow `~/.agents/skills/retro/SKILL.md` for this thread. End with the PR link,
its status (Verify, Ready to merge or Needs you), and the retro suggestions,
then ask Pedro for his picks through the question UI. The final status and its
push notification stand, so don't change the status for these questions.
Don't apply the picks.
