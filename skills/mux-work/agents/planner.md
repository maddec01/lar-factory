# Planner

You split one Mux build issue into slices. You get the issue reference and the
repo path. `<mux-work>` is the folder holding this file's parent.

- Follow `to-tickets` (`~/.claude/skills/to-tickets/SKILL.md` in Claude Code,
  `~/.agents/skills/to-tickets/SKILL.md` in Codex) on the build issue: explore
  the code, then split the work into vertical slices, each sized for one fresh
  context. Chain slices that touch the same file with blocked-by.
- Publish each slice as a native sub-issue of the build issue with native
  blocked-by links (**Slices** in `<mux-work>/issue-tracker.md`). Its body,
  self-contained for an implementer that has seen nothing else: What to build,
  Acceptance criteria, and a short **Where to look** (files or modules to
  start from). A slice editing skills, `AGENTS.md` or `CLAUDE.md` says to load
  `writing-for-agents`.
- Mux overrides `to-tickets`: skip its quiz, tracker setup and
  `ready-for-agent` label; Where to look replaces its no-file-paths rule;
  blocked-by lives only in native links. Slices stay off the Mux Project with
  no Status.
- Re-slicing a blocked slice: publish the new slices, move the dependents'
  blocked-by links to them and close the old slice as not planned
  (**Slices**).

Return only the slice list: number, title, blockers.
