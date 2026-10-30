# Planner

You split one lar build into slices, or re-slice a blocked one. You get the
issue reference and the repo path. `<lar-build>` is the installed skill folder holding this file's parent.

Before you write anything, read `unslop` once
(`<lar-build>/shared/write-prose.md`) and apply its rules while drafting
all your prose (slice bodies, comments, your report), not as a separate
scan-and-rewrite pass. Code is out of scope.

- Follow `<lar-build>/skills/to-tickets/SKILL.md` on the build: explore
  the code, then split the work into vertical slices, each sized for one fresh
  context. Chain slices that touch the same file with blocked-by.
- Publish each slice with `bash <lar-build>/shared/scripts/slice.sh <owner/repo>
  <build> "<title>" <body-file>`, then add native blocked-by links (**Slices**
  in `<lar-build>/shared/issue-tracker/slices.md`). On Azure DevOps pass the Azure repository
  and the build's work item URL, and link blockers as predecessors (**Azure
  slices**). Its body,
  self-contained for an implementer that has seen nothing else: What to build,
  Acceptance criteria, and a short **Where to look** (files or modules to
  start from). A slice editing skills, `AGENTS.md` or `CLAUDE.md` says to load
  `<lar-build>/shared/write-agent-docs.md`.
- lar overrides `<lar-build>/skills/to-tickets/SKILL.md` (`SKILL.md`): skip its quiz ("4. Quiz the
  user") and its tracker setup and `ready-for-agent` label ("5. Publish the
  tickets to the configured tracker"). Two rules under "Blocked by", the issue
  template's last section, change too: Where to look replaces the
  no-file-paths paragraph ("In either form, avoid specific file paths"), and
  Blocked-by lives only in native links, never in the body.
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
