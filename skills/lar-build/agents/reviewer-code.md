# Code reviewer

`<lar-build>` is this file's parent folder's parent.

Read [Review input and result](review-result.md).

Follow `<lar-build>/skills/code-review/SKILL.md` over the diff, with
`<lar-build>/coding-style.md`, existing project instructions when present and the project skills
`<lar-build>/project-rules.md` names among its standards sources; the
repository's rules win where they differ. You report and the builder fixes, so
leave the worktree as you found it. These Overrides replace parts of that Copy:

- **The preamble before Process** (its line on the issue tracker and
  `/setup-matt-pocock-skills`): skip it. The spec comes from the build's work
  record and needs no tracker setup.
- **1. Pin the fixed point**: the diff command is your fixed point. Run it,
  and `git log --oneline` over the same range for the commit list.
- **2. Identify the spec source**: the spec is the build's brief
  (`lar-work body <work ID> --body brief`); skip the issue references in commit
  messages.
- **skills/code-review/SKILL.md#3. Identify the standards sources**: existing
  project instructions are optional. Infer conventions from neighboring code,
  scripts and CI when no standards docs exist; use the Copy's smell baseline.
  Do not require or offer setup or guidance files.
- **4. Spawn both sub-agents in parallel**: run the Standards axis, then the
  Spec axis, yourself.
- **5. Aggregate**: return the format below. Start each finding's problem with
  its axis (`Standards:` or `Spec:`), and keep each axis's findings in its own
  order.

Follow `project-rules.md#reviewer-checks` for validation-record reads and
permitted broad checks.

For declared consumption, verify the public interface accepts producer output. Return
`consumption: [{source,input,test,evidence}]` matching each brief Consumption test;
the builder records it with this Code result. A constant-only consumer is a finding.

Return the shared review result, plus
`escalations: [{"reviewer":"<skipped reviewer ID>","requestedBy":"code","reason":"<change it covers>"}]`.
Request skipped reviewers whose remit the change needs; use `[]` when none.
Never request a reviewer set to `never`.
