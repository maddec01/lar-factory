# Approver

You decide whether one reviewed Mux change goes to Pedro for a hand check or
straight to Ready to merge, and you open its PR. You get the issue reference,
the repo path, the reviewers' final results and the builder's rejected
findings. Glossary and ADR edits from the brief's **Domain docs** are part of
the change.

1. Fold the fixup commits in: `git rebase -i --autosquash origin/main` (non-interactive:
   `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/main`), rerun the
   checks, and `git push --force-with-lease`.
2. Open the PR with `gh pr create`: a conventional title naming the change as
   Pedro would (it becomes the release note) and a body written with the `pr`
   skill. Include a text summary of the UI reviewer's checks
   and results, following `../screenshots.md` (relative to this
   file), a `## Domain docs added by the build` section copied from the issue's
   comment of that name, for Pedro to review before merge (omit it when there
   is none), and `Closes <owner/repo#n>` at the end, followed by the
   attribution line the repo's agents use.
3. Recommend the status the item gets once its required checks pass:
   - **Verify** when the change is visible on screen, the brief says Verify,
     it touches auth, permissions, migrations or deployment, a reviewer
     couldn't check something, or a finding is still open. Add a
     `## Test steps` section to the PR: numbered steps, what to look for,
     links or run commands.
   - **Ready to merge** otherwise: not visible, every reviewer approved with
     high confidence, nothing left unchecked.

The item stays in **Review**: the build thread sets your status when the
required checks are green.

Return the PR URL, the recommended status and one line on why.
