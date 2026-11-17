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
work through [Reconcile group](../shared/reconcile-group.md),
and run [Gate](../gate.md), including fresh Doubt and explicit approval.
Resume this build's saved phase only after its corrected digest passes; preserve
its branch and PR. A gate does not launch another build. Keep the starting input
and the approved correction distinct in the handoff.

## Human PR scope amendments

On trusted human review feedback Pedro chose to address on the board or asked
you to address in the thread, distinguish a defect in the approved scope
from an explicit Spec amendment. A write-access human's PR request is the Spec
decision for that exact change, even when it contradicts the starting input.
The frozen launch input remains provenance, not a reason to ask for that decision
again. Follow CI's identity checks before treating
remote text as authority. For an amendment, retain the starting input and cite
its author, URL, reviewed head and exact request. Trace the requested behaviour
through linked consumer briefs, the parent map, release contracts and Outcome.
Consistent consequences of that decision are already authorised: update every
affected record without asking whether the same behaviour should carry over.
Ask only if there is a genuinely open product alternative; an old contradictory
brief is evidence to correct, not a new choice.

Before the first scope, brief, map or Outcome write, list the affected delivery
work IDs in `affected.json` and run
`lar-work begin-pr-amendment <producer work ID> --feedback <GitHub review/comment URL>
--affected affected.json`. The producer's recorded PR supplies authorization for
all these originally approved linked builds, including consumers with no build
or PR yet. The parent is included automatically. This records one durable hold:
no duplicate Approve briefs card and no out-of-date issue warning while the owner
corrects the group and runs Doubt. Do not gate consumers individually or fall
back to ordinary board approval. Preserve their existing delivery dependencies.

Update confirmed scopes and briefs' Done when and Excluded, the parent map and
Outcome consistently. Reconcile affected work, run brief-scope-check and fresh
Doubt for every affected brief after all product edits. For the final display,
run `lar-work pr-amendment <producer work ID>` and save its complete output as
`amendment.json`. Run
`lar-work approve-pr-amendment <producer work ID> --file amendment.json
--digest <digest> --feedback <GitHub review/comment URL>`. The command rereads
the same human request and write permission, checks the exact corrected linked
content and fresh Doubt results, and commits every gate receipt together before
releasing the hold and publishing the corrected Specs. A changed brief, map,
Outcome or authorizing comment rejects the batch; review and display it again.
Lifecycle-only progress does not invalidate the displayed brief digest.

For a correction confined to one standalone build, omit `--affected`, use
`lar-work gate <work ID>` and pass its saved `display` and `approvalDigest` to
`approve-pr-amendment`. For a legacy board Verify note, use
`--feedback verify:<latest result ID>`; it reads the saved human result rather
than accepting agent-supplied approval text. The request approves this correction;
do not ask the same question again. Read back all affected published ticket Specs
through existing Spec sync before handback. If Doubt exposes an unresolved
product alternative, ask only that choice through [Questions](../shared/questions.md),
saving the resume phase so the desk shows it.

PR replies and the PR body describe the changed behaviour, validation and any
remaining delivery dependency (for example, the display ships in the consumer's
build). Keep CLI commands, gate receipts, authorization and recovery mechanics
in the owner thread. Preserve the branch, PR, frozen settings and original input.
Legacy failed-Verify dispatch follows this same rule for Pedro's exact note.
