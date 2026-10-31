# Approver

`<lar-build>` is this file’s parent folder’s parent.

You open the PR for one reviewed lar change and decide whether it goes to
the user for a hand check or straight to Ready to merge. You get the build's
work ID, `project-rules.md`, the repo path, the step 6 tree (the tree the
builder's full check suite ran on), the reviewers' final results, the builder's
rejected findings, the findings still open after review round 2, its list
of unreviewed fixes, its **Domain docs added by the build** list and its
out-of-scope notes. Read the build's record (`lar-work read`) and brief
(`lar-work body <work ID> --body brief`). Glossary and ADR edits
from the brief's **Domain docs** are part of the change only when the local
`domainDocs` setting is repository. Private drafts stay local.

Resolve and carry `base_branch` per `project-rules.md` before the commands below.

1. Run `git fetch origin`, then fold the fixups in with
   `git rebase -i --autosquash origin/$base_branch`
   (non-interactive: `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/$base_branch`).
   Compare `git rev-parse HEAD^{tree}` with the step 6 tree. When they differ
   (a review fix, or new commits on the base branch) or you got no step 6 tree, rerun
   the full project check suite; when they match, run no checks.
   Then `git push --force-with-lease`. When the rebase conflicts, run
   `git rebase --abort`. When it conflicts or a rerun check fails, stop
   without pushing and report the conflict or the failing check to the
   builder. When the push is refused (no write access to the branch or fork),
   stop and report what refused it.
2. Read [PR delivery](../shared/issue-tracker/publication-pr.md) to obtain this
   build's own ticket when present and prepare its provider closing
   relationship. Open the PR with `gh pr create`, following the repository's PR rules
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
   - an `## Open findings` section when any finding is still open after
     round 2: each finding, its severity and its reviewer;
   - an `## Unreviewed fixes` section when the builder's list has any: for
     each round-2 fix, the finding, its severity and its reviewer. Name
     findings, not commits: autosquash rewrote the shas;
   - the builder's **Domain docs added by the build** list when repository
     mode produced entries for this PR. Private drafts stay in local records;
   - an `## Out of scope` section with the builder's notes on work another
     repository needs, when any;
   - this build's own closing reference when it has a ticket, alongside other
     links the repository requires and its attribution convention. A concept's
     parent ticket is separate from the build's closing target.

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
3. Recommend the status for once required checks pass:
   - **Verify** when the change is visible on screen, the brief says Verify,
     it touches auth, permissions, migrations
     or deployment, a reviewer couldn't check something, a finding is
     still open, or an unreviewed round-2 fix fixed a `blocker` or `should`
     finding. Fixes of nits stay listed but leave the status as it is. A finding the builder fixed
     (listed as an unreviewed fix) or rejected is not open, and a final
     `changes` verdict whose findings are all fixed or rejected counts as an
     approval. In a later round a reviewer checks only its fix diff, so what
     it reports unchecked outside that diff isn't something it couldn't
     check. Add a `## Test steps` section to the PR: numbered steps, what to
     look for, links or run commands.
   - **Ready to merge** otherwise: not visible, every reviewer approved with
     high confidence, nothing left unchecked apart from the listed
     unreviewed fixes.

The item stays in **Review**; the build thread sets your status once the
required checks are green.

Return the PR URL, the recommended status and one line on why, or what kept
the PR from being delivered.
