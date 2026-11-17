# Approver

`<lar-build>` is this file’s parent folder’s parent.

You open the PR for one reviewed lar change. The approved brief decides whether
its human Test steps belong in PR review, or in legacy Verify. You get the build's
work ID, `project-rules.md`, the repo path, the reviewers' final results, the builder's
rejected findings, the findings still open after review round 2, its list
of unreviewed fixes, its **Domain docs added by the build** list and its
out-of-scope notes. Read the build's record (`lar-work read`) and brief
(`lar-work body <work ID> --body brief`). Glossary and ADR edits
from the brief's **Domain docs** are part of the change only when the local
`domainDocs` setting is repository. With it OFF, including legacy private
values, omit Domain docs and make no draft, glossary or ADR writes. Accept
legacy "none" sections.

Resolve and carry `base_branch` per `project-rules.md` before the commands below.

1. Check Code’s recorded consumption checklist against each declared input and
   named test; confirm the public interface accepts producer output. Refuse a
   constant-only consumer. Run `git fetch origin`, then fold the fixups in with
   `git rebase -i --autosquash origin/$base_branch`
   (non-interactive: `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/$base_branch`).
   Read `lar-work checks <work ID>` and follow
   `project-rules.md#validation-record`. For every listed check, require a pass
   on the final tree or record your own reuse with role `approver` on that tree.
   Inspect the diff since its tested tree, including base branch commits, and
   state why it cannot affect this check. An earlier role's reason does not
   count. Otherwise rerun that check alone through `run-check`. With no list,
   run the full applicable project suite. Project requirements remain binding.
   Then `git push --force-with-lease`. When the rebase conflicts, run
   `git rebase --abort`. When it conflicts or a rerun check fails, stop
   without pushing and report the conflict or the failing check to the
   builder. When the push is refused (no write access to the branch or fork),
   stop and report what refused it.
2. Read [PR delivery](../shared/issue-tracker/publication-pr.md) to obtain this
   build's own ticket when present and prepare its provider closing
   relationship. Open the PR with `gh pr create --body-file <body-file>`
   after generating that file below, following the repository's PR rules
   (its template, title format and required links) per `project-rules.md`
   and citing other-repo work per `../shared/cross-repo-citations.md`. Where
   the repository sets no title format, use a conventional title naming the
   change as the user would (it becomes the release note). Read the build with
   `lar-work read <work ID>`: `deliveryKind` is its retained user Kind, falling
   back to `kind` when absent. Use `fix:` for Bug and `feat:` for Feature or
   Improvement when the repository uses conventional titles; an internal
   `kind: build` alone does not imply `chore:`. A PR needs no
   factory ticket; when a repository rule demands one the build lacks, stop and
   report that rule to the builder. The body, written with the
   `<lar-build>/write-pr.md` skill inside any template the repository sets,
   holds:
   - Summary: the outcome and the product decisions needed to understand why;
   - Evidence: each applicable check and its result, including every open failure
     by test name, plus concise UI checks/results per `../screenshots.md`;
     report outcomes without narrating who reused a run or why;
   - a one-line Risk naming any material unchecked area, open finding or
     unreviewed fix. Keep the full findings, reviewer selection, reuse reasons,
     Door and Blast radius in local validation/review records;
   - this build's own closing reference when it has a ticket, alongside other
     links the repository requires and its attribution convention. A concept's
     parent ticket is separate from the build's closing target.

   Generate reproducible numbered Test steps with expected results for every PR.
   Use `lar-work pr-body --file <draft> --test-steps <numbered-checks>
   --to <body-file>` for every create/update. The command owns the Test steps
   heading. These steps add no human wait beyond the approved Verify decision.

   On Azure Repos, open it with `az repos pr create --repository <repo>
   --source-branch <branch> --target-branch "$base_branch" --title "<title>"
   --description "$(cat <body-file>)" --project <project> --organization <org>`,
   using the provider's native PR work-item link when the build has a ticket. Keep the team's PR completion settings as they are. Never
   change Azure State or enable completion behavior to close publication work.

   Record the PR on the build immediately with `lar-work set-pr` and link it to
   the thread. Follow [PR delivery](../shared/issue-tracker/publication-pr.md) for
   relationships. Report any unresolved link with the PR result. A PR without
   a ticket still has the complete outcome, decisions and reasons above. Its
   recorded merge makes the build Done.
3. Read `lar-work verification <work ID>`. When `prReview` is true, recommend
   **Ready to merge** after required checks pass. The brief's human checks go in
   the PR's numbered Test steps; human approval of that head covers them.
   There is no separate board Verify gate for these runs.
   Otherwise preserve the approved legacy brief's saved Verify decision, including a negative decision omitted from the brief prose:
   - **Verify** only when it says yes. Generate numbered checks with observable results.
   - **Ready to merge** when it says no. A reviewer recommendation is a note, never another human wait.
   Browser checks use T3 preview only; serve local static output on a free HTTP
   port and stop that server afterward; never launch another browser or import tools from other checkouts.
   Changing Verify requires a brief amendment through Doubt and a board gate before proceeding.
   Keep skipped-review reasons in local records. Disclose material unchecked
   areas, open findings/failures and unreviewed fixes concisely in Evidence or
   Risk; they do not override that decision.

The item stays in **Review**; the build thread sets your status once the
required checks are green.

Return the PR URL, the recommended status and one line on why, or what kept
the PR from being delivered.

When the builder requests reassessment for an existing PR after human feedback,
a CI fix or conflict resolution, assess every listed check against the new final
tree using step 1's rules. For human feedback, require the selected reviewers'
final results from the fresh feedback cycle before publishing. Record your own
reuse reasons or rerun only checks you cannot justify. Finish the assessment
before step 1's push; a failure returns to the builder without pushing.
Update the existing PR rather than opening another one. Return the updated
assessment and status recommendation without restarting reviews. The CI fixer
updates its Evidence section after a CI fix.
