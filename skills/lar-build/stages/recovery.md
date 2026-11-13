# Recovery

Input: failed role, wrong scope, conflict or missing decision. Output: proven
work retained, exact unresolved hold, or approved correction and resume phase.

Work in another repository (a planner or implementer `needs <owner/repo>`, a
failed check or a failed Verify) is routed per [Other repositories](../shared/issue-tracker/other-repositories.md). Tell the user in chat what
that repository needs and offer the choices that section gives for it: a build
there within the user's authorized scope, or onboarding or a
Dependency for a repository that is not onboarded. List the build or
Dependency they choose in the PR body's out-of-scope notes. This build carries
on when it can work without it; otherwise use the question stop below. A slice holding that work is
set aside (`lar-work set-aside`). A failed Verify is fixed in this build; a
merged build is never reopened.

If a decision is missing, follow [Questions](../shared/questions.md) and keep
its exact resume phase. A Clash follows [Project rules](../project-rules.md).
If the brief is wrong, pause implementation, explain the evidence and resolve
missing product choices. Revise through [Brief](../brief.md), reconcile affected
work through [Other repositories](../shared/issue-tracker/other-repositories.md),
and run [Gate](../gate.md), including fresh Doubt and explicit approval.
Resume this build's saved phase only after its corrected digest passes; preserve
its branch and PR. A gate does not launch another build. Keep the starting input
and the approved correction distinct in the handoff.

