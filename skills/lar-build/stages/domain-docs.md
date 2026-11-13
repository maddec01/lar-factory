# Domain docs

Input: brief drafts, local domain-doc setting and new build decisions. Output:
committed docs and the current **Domain docs added by the build** list.
Set phase `domain-docs`.

Read where the repository keeps domain docs (**Where domain docs live** in
   `<lar-build>/shared/domain-docs.md`). When they live in the repository, a
   subagent writes the brief's **Domain docs** to those paths in its own
   commit, following that file's glossary and ADR formats and next ADR number,
   creating the glossary or ADR folder only for their first entry. A doc that
   cites its origin names the record's ticket when it has one, otherwise the
   build PR, never a work ID or local path. Its prompt carries
   `<lar-build>/shared/cross-repo-citations.md` for citing other-repo work.
   With domain docs OFF, this step does nothing, creates no drafts and leaves
   the brief's Domain docs as "none". A saved private value also means OFF.
   With domain docs ON, add a new term or ADR-worthy decision settled during
   the build the same way, using the fixer during review without stopping.
   Each ADR must meet all three conditions in the domain-doc guide.
   Keep a list of each, headed **Domain docs added by the build**,
   current through review fixes, for the reviewers and approver. With domain
   docs OFF, leave this list empty and offer no later publication.
Continue to [Full checks](full-checks.md).
