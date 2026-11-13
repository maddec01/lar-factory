## 3. Brief

Write the brief to a file, then save it in the record with
`lar-work set-body <work ID> --revision N --body brief --file <file>`. The
user's original text stays in the record's initial context.

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
prototype branch; omit code tours, line numbers and step-by-step implementation
recipes. Omit empty optional sections. A routine brief should fit on one screen;
add detail only when it changes what a reviewer must accept.

Read the local [domain-doc setting](shared/domain-docs.md#where-domain-docs-live)
before drafting. With it OFF, write `none` under Domain docs and create no drafts.
With it ON, use the entries and ADR drafts in the template below.

```markdown
## What
<the change, in the user's domain language>

## Done when
- <observable result a reviewer can check>

## Confirmed
- <each assumption the user confirmed, and each decision with its gist>

## Notes for the builder
<essential constraints or a chosen prototype branch>
Files: `<repo-relative path>`, ... (or none)
Contracts: `<shared contract name>`, ... (or none)

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry>, or "none"
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft>, or "none"

## Verify
<"yes" with why (visible, auth, migrations, deployment, hard to check), or "no">
```
