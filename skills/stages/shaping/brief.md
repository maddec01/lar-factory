## 3. Brief

Input: accepted answers, code evidence and affected sibling contracts. Output:
a saved `brief` and its digest, ready for Gate.

Write the brief to a file, then save it in the record with
`lar-work set-body <work ID> --revision N --body brief --file <file>`. The
user's original text stays in the record's initial context.
Use `lar-work confirmed-scope <work ID> --markdown` for Done when, Scope and Verify below; keep scope claims there. Tests describe the cases to cover, not test files. Run `lar-work brief-scope-check <work ID>` after saving and fix every missing/extra claim before Gate.

`lar-work gate` checks required sections by Kind and names omissions; fix them before Doubt.
The brief is the builder's handover. Editing it invalidates prior gate evidence.
Run [Gate](gate.md) on the final text before marking it Ready. With Spec writing
ON, the whole passing brief becomes the ticket's main description with its prior
text kept as Original. From then on, trusted tracker edits update the record's
copy. Follow [Ticket Specs](shared/issue-tracker/ticket-specs.md).

Write for the team reading that ticket: lead with the result and observable
acceptance criteria. Keep facts once. Confirmed holds only the substance of product
decisions, such as a chosen compatibility rule or prototype. Never include question
IDs, button labels, scope-confirmation recitals or approval mechanics. Omit Confirmed
when there are no product decisions. Dependency/proof status
belongs only in Dependency records, generated beside the brief/Spec. Keep
approvals, delegation, factory IDs and workflow mechanics in records. Notes for the builder holds only constraints
or references that cannot be rediscovered from the code, such as a chosen
prototype branch, and the shared contracts the work uses; omit line numbers
and step-by-step implementation recipes. Omit empty optional sections. A routine brief should fit on one screen;
add detail only when it changes what a reviewer must accept.

State the simplest safe engineering defaults chosen during shaping in Notes for
the builder, including storage/error behaviour when relevant. These are constraints
the final brief approval covers, not product answers for Confirmed. Keep them
short and add no unrequested notices or warnings.

Set `verify.required` only when acceptance needs Pedro's own judgment or access
the agent lacks; name that need in `visibleUi` (the stored field name). An ordinary
UI change that the agent can exercise and check uses `{required:false,visibleUi:null}`.

Read the local [domain-doc setting](shared/domain-docs-setting.md)
before drafting. With it OFF, write `none` under Domain docs and create no drafts.
With it ON, follow [Domain modeling](shared/domain-docs.md) for the entries
and ADR drafts in the template below.

```markdown
## What
<the change, in the user's domain language>

<insert the command-rendered Done when, Scope and Verify sections>

## Confirmed
- <product decision and its gist; omit this section when empty>

## Notes for the builder
<essential constraints or a chosen prototype branch>
Contracts: `<shared contract name>`, ... (or none)

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry>, or "none"
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft>, or "none"

```

A `Consumes:` declaration needs a `Consumption test:` JSON line per source:
`{source,test,output,input}`: exact reference, named test case, producer shape or
producer golden fixture, and consumer public input. Gate completeness enforces it.
