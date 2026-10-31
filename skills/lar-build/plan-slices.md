Ported from mattpocock/skills, `skills/engineering/to-tickets/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md) for the Ports record.

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

Each ticket here is a slice: a private record the build owns, never published.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. Read the build's brief from its work record (`lar-work body <work ID> --body brief`).

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Record slices

Record each slice with `bash <lar-build>/shared/scripts/slice.sh <build work ID> "<title>" <body-file> [--blocked-by <slice work ID>]...`, per **Slices** in `<lar-build>/shared/issue-tracker/slices.md`. Chain slices touching the same file.

Each body contains What to build, Acceptance criteria and Where to look. Include useful file paths there. For edits to skills, AGENTS.md or CLAUDE.md, require `<lar-build>/shared/write-agent-docs.md`. The build's own record stays as it is; ask the user nothing.
