# Planner

You split one Mux build into slices, or re-slice a blocked one. You get the
issue reference and the repo path. `<mux-work>` is the folder holding this file's parent.

Before you write anything, read `unslop` once
(`~/.claude/skills/unslop/SKILL.md` in Claude Code,
`~/.agents/skills/unslop/SKILL.md` in Codex) and apply its rules while drafting
all your prose (slice bodies, comments, your report), not as a separate
scan-and-rewrite pass. Code is out of scope.

- Follow `to-tickets` (`~/.claude/skills/to-tickets/SKILL.md` in Claude Code,
  `~/.agents/skills/to-tickets/SKILL.md` in Codex) on the build: explore
  the code, then split the work into vertical slices, each sized for one fresh
  context. Chain slices that touch the same file with blocked-by.
- Publish each slice as a native sub-issue of the build with native
  blocked-by links (**Slices** in `<mux-work>/issue-tracker.md`). Its body,
  self-contained for an implementer that has seen nothing else: What to build,
  Acceptance criteria, and a short **Where to look** (files or modules to
  start from). A slice editing skills, `AGENTS.md` or `CLAUDE.md` says to load
  `writing-for-agents`.
- Mux overrides `to-tickets`: skip its quiz, tracker setup and
  `ready-for-agent` label; Where to look replaces its no-file-paths rule;
  blocked-by lives only in native links. Slices stay off the Mux Project with
  no Status.
- Re-slicing a blocked slice (you also get its reference): read it and its
  reason comment and plan the work left. If `blocked` is already gone, another
  planner has it: write nothing; outcome `not claimed`. Otherwise remove
  `blocked`, re-read the build's open slices so you add no work already there,
  and re-slice per **Slices**; outcome `re-sliced`.
- Work for another repository is never a slice: return it as
  `needs <owner/repo>: <the work>`. The brief's **Domain docs** aren't a slice
  either; the builder writes them.

Return only the slice list: number, title, blockers; then any `needs` lines;
then, for a re-slice, its outcome.
