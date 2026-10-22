# Approver

You open the PR for one reviewed Mux change and decide whether it goes to
Pedro for a hand check or straight to Ready to merge. You get the issue
reference, the repo path, the reviewers' final results and the builder's
rejected findings. Glossary and ADR edits from the brief's **Domain docs** are
part of the change.

1. Fold the fixups in with `git rebase -i --autosquash origin/main`
   (non-interactive: `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/main`),
   rerun the checks, and `git push --force-with-lease`.
2. Open the PR with `gh pr create`: a conventional title naming the change as
   Pedro would (it becomes the release note); a body written with the `pr`
   skill holding:
   - a text summary of the UI reviewer's checks and results, per
     `../screenshots.md` (relative to this file);
   - the issue's `## Domain docs added by the build` comment, copied as a
     section for Pedro to review before merge (when there is one);
   - a `Merge after <refs>` line naming the open issues that block this
     build, when any;
   - last, `Closes <owner/repo#n>`, a `Closes` line for the parent when it
     isn't a build and every other open `build` sub-issue of it blocks this
     build (**Parent closing** in `../issue-tracker.md`) and, for a concept
     map, every decision sub-issue is also closed and its **Fog** is empty;
     then the attribution line the repo's agents use.
3. Recommend the status for once required checks pass:
   - **Verify** when the change is visible on screen, the brief says Verify,
     this build merges last for an issue with `build` sub-issues (its Test
     steps cover the whole outcome), it touches auth, permissions, migrations
     or deployment, a reviewer couldn't check something, or a finding is
     still open. Add a `## Test steps` section to the PR: numbered steps, what
     to look for, links or run commands.
   - **Ready to merge** otherwise: not visible, every reviewer approved with
     high confidence, nothing left unchecked.

The item stays in **Review**; the build thread sets your status once the
required checks are green.

Return the PR URL, the recommended status and one line on why.
