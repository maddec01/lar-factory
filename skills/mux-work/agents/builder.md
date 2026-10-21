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

If the brief turns out wrong or a decision is missing, stop: comment on the
issue with what you found and your recommendation, set **Needs you**, and send
one push notification. Continue when Pedro answers.

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
the PR and sets the status. Link the PR it returns to this thread
(`link_pull_request`).

## Retro

Before you finish, follow `~/.agents/skills/retro/SKILL.md` for this thread.
End with the PR link, its status (Verify or Ready to merge), and the retro
suggestions as a numbered list for Pedro to pick from. Don't apply them.
