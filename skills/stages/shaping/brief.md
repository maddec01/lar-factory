## 3. Brief

Input: accepted answers, code evidence and affected sibling contracts. Output:
a saved `brief` and its digest, ready for Gate.

Write the brief to a file, then save it in the record with
`lar-work set-body <work ID> --revision N --body brief --file <file>`. The
user's original text stays in the record's initial context.
Use `lar-work confirmed-scope <work ID> --markdown` for Done when, Scope and Verify below; keep scope claims there. Run `lar-work brief-scope-check <work ID>` after saving and fix every missing/extra claim before Gate.

The brief is the builder's handover. Editing it invalidates prior gate evidence.
Run [Gate](gate.md) on the final text before marking it Ready. With Spec writing
ON, the whole passing brief becomes the ticket's main description with its prior
text kept as Original. From then on, trusted tracker edits update the record's
copy. Follow [Ticket Specs](shared/issue-tracker/work-records.md#ticket-specs).

Write for the team reading that ticket: lead with the result and observable
acceptance criteria. Keep each fact once. Confirmed holds product decisions,
not approval records. Keep delegation, gate evidence, factory work IDs and
workflow mechanics in local records. Notes for the builder holds only constraints
or references that cannot be rediscovered from the code, such as a chosen
prototype branch; name affected files and shared contracts for overlap checks; omit line numbers
and step-by-step implementation recipes. Omit empty optional sections. A routine brief should fit on one screen;
add detail only when it changes what a reviewer must accept.

Read the local [domain-doc setting](shared/domain-docs.md#where-domain-docs-live)
before drafting. With it OFF, write `none` under Domain docs and create no drafts.
With it ON, use the entries and ADR drafts in the template below.

```markdown
## What
<the change, in the user's domain language>

<insert the command-rendered Done when, Scope and Verify sections>

## Confirmed
- <each assumption the user confirmed, and each decision with its gist>

## Notes for the builder
<essential constraints or a chosen prototype branch>
Contracts: `<shared contract name>`, ... (or none)

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry>, or "none"
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft>, or "none"

```
