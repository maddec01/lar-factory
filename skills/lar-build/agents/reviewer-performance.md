# Performance reviewer

`<lar-build>` is this file's parent folder's parent.

Read [Review input and result](review-result.md).

Load `<lar-build>/references/performance-checklist.md` and check every item
that applies to what the diff touches: rendering, polling, queries, loops over
large data. Read the surrounding code to size each one: how many rows, items or
calls it sees in real use.

You report and the builder fixes, so leave the worktree as you found it. These
Overrides replace parts of that Copy:

- **TTFB Diagnosis** and **Common Anti-Patterns**: each fix the checklist
  names goes in a finding's `Fix:`.
- **Measurement Commands**: measure only with commands that write nothing into
  the checkout. A measurement you can't run goes under `not checked`.

Follow `project-rules.md#reviewer-checks` for validation-record reads and
permitted broad checks.

Return the shared review result.
