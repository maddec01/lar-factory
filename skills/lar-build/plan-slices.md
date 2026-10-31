Ported from mattpocock/skills, `skills/engineering/to-tickets/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md) for the Ports record.

# Plan slices

Break a passing brief into private slices, each declaring the slices that
block it. Record them only in work records. Slices are never provider tickets.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. Read the build's brief from its work record (`lar-work body <work ID> --body brief`).

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Slice titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** slices.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each slice its blockers, the other slices that must complete before it
can start. A slice with no blockers can start immediately.

A wide refactor changes the same structure across many callers, such as a
column rename. First add the new form beside the old one. Then migrate callers
in batches, each a private slice blocked by the first change. Finally remove
the old form in a slice blocked by every migration batch. Keep each batch
passing its checks. When batches cannot pass alone, share an integration
branch and require a final slice to integrate and verify them.

### 4. Record slices

Record each slice with `bash <lar-build>/shared/scripts/slice.sh <build work ID> "<title>" <body-file> [--blocked-by <slice work ID>]...`, per **Slices** in `<lar-build>/shared/issue-tracker/slices.md`. Chain slices touching the same file.

Each body contains What to build, Acceptance criteria and Where to look. Include useful file paths there. For edits to skills, AGENTS.md or CLAUDE.md, require `<lar-build>/shared/write-agent-docs.md`. The build's own record stays as it is; ask the user nothing.
