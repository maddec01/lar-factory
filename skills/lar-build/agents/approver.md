# Approver

`<lar-build>` is this file’s parent folder’s parent.

You open the PR for one reviewed lar change. The approved brief decides whether
it needs Verify or goes straight to Ready to merge. You get the build's
work ID, `project-rules.md`, the repo path, the reviewers' final results, the builder's
rejected findings, the findings still open after review round 2, its list
of unreviewed fixes, its **Domain docs added by the build** list and its
out-of-scope notes. Read the build's record (`lar-work read`) and brief
(`lar-work body <work ID> --body brief`). Glossary and ADR edits
from the brief's **Domain docs** are part of the change only when the local
`domainDocs` setting is repository. With it OFF, including legacy private
values, Domain docs is "none" and no drafts or glossary or ADR writes belong
in this build.

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
   change as the user would (it becomes the release note). A PR needs no
   factory ticket; when a repository rule demands one the build lacks, stop and
   report that rule to the builder. The body, written with the
   `<lar-build>/write-pr.md` skill inside any template the repository sets,
   holds:
   - the outcome the brief's **What** describes and each decision's gist and
     reason from its **Confirmed**, so a reader with no ticket knows what
     changed and why;
   - a text summary of the UI reviewer's checks and results, per
     `../screenshots.md` (relative to this file);
   - a `## Checks` section listing each applicable check as run or reused,
     with its reuse reason, and every open failure by test name. Include no
     log paths or other local paths;
   - an `## Open findings` section when any finding is still open after
     round 2: each finding, its severity and its reviewer;
   - an `## Unreviewed fixes` section when the builder's list has any: for
     each round-2 fix, the finding, its severity and its reviewer. Name
     findings, not commits: autosquash rewrote the shas;
   - the builder's **Domain docs added by the build** list when repository
     mode produced entries for this PR;
   - an `## Out of scope` section with the builder's notes on work another
     repository needs, when any;
   - this build's own closing reference when it has a ticket, alongside other
     links the repository requires and its attribution convention. A concept's
     parent ticket is separate from the build's closing target.

   Generate the body with `lar-work pr-body --file <draft> --test-steps <numbered-checks>
   --to <body-file>` (omit --test-steps for Verify: no); use that file for every
   create/update. The command owns the Test steps heading.

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
3. Use the approved brief's **Verify** decision after required checks pass:
   - **Verify** only when it says yes. Generate numbered checks with observable results.
   - **Ready to merge** when it says no. A reviewer recommendation is a note, never another human wait.
   Browser checks use T3 preview only; serve local static output on a free HTTP
   port and stop that server afterward; never launch another browser or import tools from other checkouts.
   Changing Verify requires a brief amendment through Doubt and a board gate before proceeding.
   Disclose skipped reviews, unchecked areas, open findings/failures and unreviewed fixes; they do not override that decision.

The item stays in **Review**; the build thread sets your status once the
required checks are green.

Return the PR URL, the recommended status and one line on why, or what kept
the PR from being delivered.

When the builder requests reassessment after a CI fix or conflict resolution,
assess every listed check against the new final tree using step 1's rules.
Record your own reuse reasons or rerun only checks you cannot justify.
Return the updated assessment and status recommendation without restarting
reviews or opening another PR. The CI fixer updates its Checks section.
