# Builder

You build one Mux issue in your own worktree, then run its review. You start
from the issue's brief alone. Don't look for the shaping conversation.

You orchestrate: subagents explore, edit code, run checks and drive the
browser; you hold their reports, merge slices and run review.

Status changes use `bash <mux-work>/scripts/status.sh <owner/repo#n> "<Status>"`,
where `<mux-work>` is the folder holding this file's parent.

## Subagents

- **Spawn**: in Claude Code, the `Agent` tool (`subagent_type: "general-purpose"`,
  or `"Explore"` for read-only work); `SendMessage` to its agent ID sends it more
  work. In Codex, `spawn_agent`, then `wait` for its report; `send_input` sends
  it more work.
- **Report**: every prompt carries the report rule from `<mux-work>/SKILL.md`
  (**Rules**: ≤300 words, no whole files, logs or screenshots); check runs
  report pass/fail and only the failures that matter.
- **Fixer**: makes changes on the build branch in this worktree as
  `git commit --fixup <sha>` commits, reruns the checks and reports.
- **UI-check**: runs the visible checks and Verify captures, following
  **Screenshots** in `<mux-work>/SKILL.md`. It keeps screenshots in its own
  context and returns their absolute paths and a verdict.

## Build

1. Set **In progress**, unless a handoff resumes past **Build**. Read the issue (brief, comments, linked prototype or
   research branches) and the repo's `AGENTS.md`. Run the repo's worktree setup
   if `AGENTS.md` asks for it.
2. **Plan.** If the build issue already has slices (a handoff), remove any
   leftover slice worktrees and branches, then **Implement** the ready slices
   fresh. Otherwise start a **planner** subagent with the issue reference, the repo
   path and these instructions:
   - Read `to-tickets` at `~/.claude/skills/to-tickets/SKILL.md` (Claude Code)
     or `~/.agents/skills/to-tickets/SKILL.md` (Codex) and follow it on the
     build issue: explore the code, then split the work into vertical slices,
     each sized for one fresh context. Chain slices that touch the same file
     with blocked-by.
   - Publish each slice as a native sub-issue of the build issue with native
     blocked-by links, using **Slices** in `<mux-work>/issue-tracker.md`. Its
     body has What to build, Acceptance criteria and a short **Where to look**
     (the files or modules to start from), self-contained for an implementer
     that has seen nothing else.
   - Mux overrides `to-tickets`: skip its quiz, tracker setup and
     `ready-for-agent` label; Where to look replaces its no-file-paths rule;
     blocked-by lives only in the native links. Slices stay off the Mux Project
     and get no Status.
   - Return only the slice list: number, title, blockers.
3. **Implement.** Start an **implementer** subagent per ready slice (the
   ready-slices command in **Slices**) that has no implementer running yet
   (track the ones you started), in parallel, each in its own worktree:
   - Claude Code: `isolation: "worktree"`; the implementer first runs
     `git switch -c slice/<n>-<m>-<slug> <build-branch>`.
   - Codex has no worktree isolation: run
     `git worktree add ${TMPDIR:-/tmp}/mux-<n>-slice-<m> -b slice/<n>-<m>-<slug> <build-branch>`
     and give the implementer that path (the repo's post-checkout hook runs its
     worktree setup).

   Give it the slice reference, the build branch and these instructions: read
   `implement` at `~/.claude/skills/implement/SKILL.md` (Claude Code) or
   `~/.agents/skills/implement/SKILL.md` (Codex) and follow it for the slice,
   test-first with `tdd`, using `developer-profile` and, when a module's shape
   changes, `codebase-design`. Skip its code review step. Each commit is one
   reviewable step with a conventional message (`AGENTS.md` lists types and
   scopes), never a fixup. Run the checks `AGENTS.md` names for the layers
   changed, then rebase onto the build branch tip. It reports its absolute
   worktree path and slice branch.
4. **Merge.** As each implementer reports, run
   `git merge --ff-only slice/<n>-<m>-<slug>` here. When it can't fast-forward,
   send the slice back to its implementer (or a fresh subagent) to rebase onto
   the build branch tip, then merge again. After each merge, remove the reported
   worktree and slice branch, close the slice sub-issue (**Slices**) and run
   **Implement** again. When an implementer reports its slice blocked (too
   big, checks won't pass), send it back to the planner to re-slice: it
   publishes the new slices, moves the dependents' blocked-by links to them and
   closes the replaced slice as not planned (**Slices**). When the brief is
   wrong, follow the stop rule below. The step is done when every slice is
   closed.
5. Have a subagent write the brief's **Domain docs** into the repo in its own
   commit, following `domain-modeling`: its glossary and ADR formats, the next
   ADR number, and `GLOSSARY.md` or `docs/adr/` created only when the first
   entry needs it. When the build itself settles a new term or an ADR-worthy
   decision (all three conditions), have a subagent (the fixer during review)
   add it the same way, keep going, and list it yourself in one issue comment
   headed **Domain docs added by the build**, edited whenever the list changes
   (review fixes included), so reviewers and the approver see it. Creating
   `GLOSSARY.md` or `docs/adr/` includes linking it from `AGENTS.md` as the
   repo's `docs/agents/domain.md` says; a repo without it gets a **Domain docs** section in `AGENTS.md`
   pointing to both, modelled on mux-apple's `### Domain docs`.
6. Have a subagent run the checks `AGENTS.md` names for the layers changed; a
   UI-check subagent checks anything user-visible. Failures go to the fixer.
   All must pass.
7. Push the branch. Don't open the PR yet.

Every question to Pedro follows the question UI rule in `<mux-work>/SKILL.md`
(**Rules**): Needs you, then `AskUserQuestion`, then
the answers on the issue and the status back.

Past about 150k tokens, follow the handoff rule in `<mux-work>/SKILL.md`
(**Rules**), relaunching in this worktree and branch. A relaunched builder
resumes at the step and review round its handoff names.

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
check. Hand every `changes` finding you agree with to the fixer; reply to the
ones you reject with a reason. Then run only
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

- **Required checks green**: set the recommended status, then `unwatch_pull_request`.
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

Show the UI reviewer's and UI-check's screenshots in this build conversation, with captions
and absolute file paths, so Pedro can inspect them alongside the PR link.

Run this once, last, after the final status is set and the PR is unwatched.
Follow `~/.agents/skills/retro/SKILL.md` for this thread. End with the PR link,
its status (Verify, Ready to merge or Needs you), and the retro suggestions,
then ask Pedro for his picks through the question UI. The final status stands,
so don't change the status for these questions.
After Pedro answers, follow [Retro capture](../retro-capture.md) to create or
reuse follow-up issues for his picks and report their links and any pending
failures. Capture is required; “don't apply the picks” means leave their
implementation for later. Keep the final status throughout capture and retries.
