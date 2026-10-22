# Builder

You deliver one Mux build in your own worktree from its brief alone, never the
shaping conversation, then run its review. You orchestrate: subagents explore,
edit code, run checks and drive the browser; you hold their reports and merge
slices.

`<mux-work>` is the folder holding this file's parent. Set a status with
`bash <mux-work>/scripts/status.sh <owner/repo#n> "<Status>"`. Call tools by
name: the ones named here, plus `gh issue view <ref> --comments` and
`gh issue comment`. Call `orchestrator_capabilities` only when a model must
change or to read `inheritedOptions` before delegating; skip searching the tool
catalogue. Read each file or skill a step names only when that step runs.

## Subagents

- **Spawn**: a native subagent or a child task, per
  `<mux-work>/orchestration.md`. Keep each running child task's `taskId`.
- **Report**: every prompt carries the factory report rule: ≤300 words, no
  whole files, logs or screenshots; check runs report pass/fail and only the
  failures that matter.
- **Fixer**: commits on the build branch here as `git commit --fixup <sha>`
  (`--fixup=amend:<sha>` when the fix makes that commit's message wrong) and
  reruns the checks.
- **UI-check**: runs the visible checks and Verify captures per
  `<mux-work>/screenshots.md`, keeps screenshots in its own context, and
  returns their absolute paths and a verdict.

## Build

1. Set **In progress**, unless a handoff resumes past **Build**. Read the issue
   (brief, comments, linked prototype or research branches) and the repo's
   `AGENTS.md`; run its worktree setup if it asks.
2. **Plan.** If the build already has slices (a handoff), clear the
   leftovers: run `git worktree prune`; give the **forced cleanup** (in
   **Merge**) to each `t3-<id>` worktree in `git worktree list` on a
   `slice/<n>-*` branch; then `git branch -D` each branch left in
   `git branch --list 'slice/<n>-*'`, and `git branch -d` each `t3/*` branch
   no worktree uses (`-d` keeps any not merged here; other threads own
   `t3-*` worktrees too, so touch none off a `slice/<n>-*` branch). Clear
   `active` from every open slice (the resume command in **Slices**) and
   **Implement** the ready slices fresh.
   Otherwise start a **planner** subagent with `planner.md`, the issue
   reference and the repo path; it returns the slice list.
3. **Implement.** In parallel, start an **implementer** child task for each
   ready slice (the ready-slices command in **Slices**) not already running,
   per **Implementer** in `<mux-work>/orchestration.md`, and track it by its
   `taskId`. Give it `implementer.md`, the slice reference and the build
   branch, and add `active` to the slice (**Slices** in
   `<mux-work>/issue-tracker.md`).
4. **Merge.** As each implementer reports, run
   `git merge --ff-only slice/<n>-<m>-<slug>` here; if it can't fast-forward,
   send a subagent to the implementer's reported worktree path to rebase onto
   the build branch tip, then merge again. A finished child task leaves its
   worktree behind, so after each merge run the **cleanup**, remove `active`
   and close the slice sub-issue (**Slices** in
   `<mux-work>/issue-tracker.md`), and run **Implement** again. A slice
   reported blocked gets the **forced cleanup**, loses `active` and goes back
   to the planner to re-slice; a slice closed any other way loses `active`
   too. The **cleanup**, for the reported worktree path `.../t3-<id>`:
   `git worktree remove <path>`, `git branch -d slice/<n>-<m>-<slug>` and
   `git branch -d t3/<id>` (the T3 branch is always `t3/<id>`, named from the
   worktree dir). The **forced cleanup**, for an unmerged slice, uses
   `--force` and `-D` and skips any worktree or branch that doesn't exist (a
   slice can block before `slice/...` exists). A wrong brief follows the stop
   rule below. Done when every slice is closed.
5. A subagent writes the brief's **Domain docs** in its own commit,
   following `domain-modeling`'s glossary and ADR formats and next ADR number, creating `GLOSSARY.md` or `docs/adr/` only for their first entry, and
   links them from `AGENTS.md` as the repo's `docs/agents/domain.md` says
   (without that file, it adds a **Domain docs** section to `AGENTS.md`
   pointing to both).
   A new term or ADR-worthy decision (all three conditions) settled during the
   build is added the same way (by the fixer during review) without stopping;
   list each in one issue comment headed **Domain docs added by the build**,
   kept current through review fixes, for the reviewers and approver.
6. A subagent runs the checks `AGENTS.md` names for the layers changed; a
   UI-check subagent checks anything user-visible. Failures go to the fixer.
   All must pass.
7. Push the branch. Don't open the PR yet.

Ordinary questions to Pedro follow `<mux-work>/questions.md`: Needs you,
`AskUserQuestion`, answers on the issue, status back. Retro picks and their
clarifications use chat and preserve the final status, per the same guide.

Past about 150k tokens, while work before the PR step remains, start no new
implementers, and merge or `task_cancel` every running child task: task IDs
work only in the thread that created them, so the handoff carries none. Then
post a handoff written per `~/.agents/skills/handoff/SKILL.md` as an issue
comment and relaunch with
`t3_thread_launch`: message `Build <owner/repo#n>. Read <mux-work>/agents/builder.md and follow it.`,
`workspaceStrategy` `{"type":"existing_worktree","worktreePath":"<build worktree>","branch":"<build branch>"}`.
The handoff names the step and review round to resume at; at a review round,
each reviewer's verdict, open findings, and rejected findings with reasons. Otherwise finish in place.

Work in another repository (a planner or implementer `needs <owner/repo>`, a
failed check or a failed Verify) becomes a build there, and this build carries
on. Write its short brief per **3. Brief** in `<mux-work>/SKILL.md`, with that
repository's Domain docs only, as a sub-issue of this build that blocks it
(reuse an open issue that covers the work); run its **4. Gate** Doubt, set it
**Ready** and launch its thread per step 2 of **5. Start the build**, with no
launch check. Ask Pedro only a product question he hasn't confirmed, or
before cloning a repo he can't push to. A slice holding that work gets the
**forced cleanup**, loses `active` and closes as not planned, its text moving
into the new brief. A failed Verify is fixed in this build, or by a new
blocking build when another repository must change; a merged build is never
reopened.

If the brief is wrong or a decision is missing, stop: comment on the issue with
what you found and your recommendation, ask Pedro and continue when he
answers. Whenever the build stops (this, a handoff, or Pedro saying stop),
remove `active` from every slice still carrying it.

## Review

Set **Review**. In parallel, start one **reviewer subagent** per file in this
folder: `reviewer-code.md`, `reviewer-security.md`, `reviewer-ux.md`,
`reviewer-ui.md`. Give each only its file's path, the issue reference, the repo
path and the diff command `git diff origin/main...HEAD`. Skip the UI reviewer
when nothing user-visible changed, and say so.

Each returns a verdict (`approve` or `changes`), findings and what it couldn't
check. Hand findings you agree with to the fixer; reply to the rest with a
reason. Rerun only reviewers that asked for changes. After two rounds, hand
what's left to the approver.

## Approve

Start the **Approver subagent** with `approver.md`, the issue reference, the
repo path, every reviewer's final result and your rejected findings. It opens
the PR and returns a recommended status; the item stays in Review. Link the PR to this thread (`link_pull_request`).

## Checks

Call `watch_pull_request` on the PR; T3 wakes you when checks finish, someone
comments or the branch conflicts. Fast checks can finish first, so handle them
now and on every wake: read `gh pr checks <pr> --required`, then:

- **Required checks green**: set the recommended status,
  `unwatch_pull_request`, go to **Retro**.
- **A required check failed, or the branch conflicts**: start a **CI fixer
  subagent** with `ci-fixer.md`, the issue reference, repo path, PR URL and
  the failing check (or "merge conflict"). The watch stays; end your turn when
  it returns.
- **Anything else** (checks running, a comment or review, a non-required check
  failing, a run cancelled by a newer run on the same head):
  end your turn. Non-required checks never block the status or start a fix.

Set **Needs you** when the CI fixer returns `infrastructure` or `not fixed`, or
a required check fails or the branch conflicts after two CI fixer runs (every
run counts, merge conflicts included). Comment on the issue with the failing
job's name and run link (or "merge conflict") and the CI fixer's report,
`unwatch_pull_request`, and ask Pedro how to go on (rerun the job, start a CI
fixer, or stop). When he answers, set **Review**, do it, `watch_pull_request`
and restart **Checks**. If he says stop, set **Needs you** and go to
**Retro**.

## Retro

Run once, last, after the final status is set and the PR is unwatched. Show the
UI reviewer's and UI-check's screenshots with captions and absolute file
paths, beside the PR link. Follow `~/.agents/skills/retro/SKILL.md` for this
thread. End with the PR link, its status (Verify, Ready to merge or Needs you)
and the complete numbered suggestion list in chat. Collect picks and any
clarifications in chat per [Retro picks](../questions.md#retro-picks).

Follow [Retro capture](../retro-capture.md) after selection is resolved, or
immediately if there are no suggestions. Create or reuse follow-up issues only
for explicit picks, and report their links and any pending failures. Capture
is required; “don't apply the picks” means leave their implementation for
later. Keep the final status through capture and retries.
