## 3. Brief

Input: accepted answers, code evidence and affected sibling contracts. Output:
a saved `brief` and its digest, ready for Gate.

Write the brief to a file, then save it in the record with
`lar-work set-body <work ID> --revision N --body brief --file <file>`. The
user's original text stays in the record's initial context.
Use `lar-work confirmed-scope <work ID> --markdown` for Done when and any stated
Scope or Verify sections below; keep scope claims there. A negative Verify
decision stays in the scope record and needs no published section. Tests describe
the cases to cover, not test files. Run `lar-work brief-scope-check <work ID>`
after saving and fix every missing/extra claim before Gate.

`lar-work gate` checks required sections by Kind and names omissions; fix them before Doubt.
The brief is the builder's handover. Editing it invalidates prior gate evidence.
Run [Gate](gate.md) on the final text before marking it Ready. With Spec writing
ON, the passing brief's team-facing prose becomes the ticket's main description with its prior
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
and step-by-step implementation recipes. Omit empty optional sections, empty
Size or Excluded headings, and absent Contracts or Blocked by lines. Keep empty
blocker declarations in local maps per [Structure](shared/issue-tracker/structure.md).
Linked-work declarations (`Blocked by`, `Consumes`, `Produces`, `Contracts`,
`Parent contract`, `No ordering needed` and `Consumption test`) remain parseable
in the local brief and are omitted from published Specs. Keep the actual
compatibility and acceptance requirements in the prose. Under Done when, use
`### Behaviour` and `### Tests` consistently; Tests is never a top-level section.
Never add "none" placeholders. A routine brief should fit on one screen;
add detail only when it changes what a reviewer must accept.

State the simplest safe engineering defaults chosen during shaping in Notes for
the builder, including storage/error behaviour when relevant. These are constraints
the final brief approval covers, not product answers for Confirmed. Keep them
short and add no unrequested notices or warnings. Leave other mechanics the
code shows to the builder.

Set `verify.required` only when acceptance needs the user's own judgment or access
the agent lacks; name that need in `visibleUi` (the stored field name). An ordinary
UI change that the agent can exercise and check uses `{required:false,visibleUi:null}`.

Read the local [domain-doc setting](shared/domain-docs-setting.md)
before drafting. With it OFF, omit Domain docs and create no drafts. With no
entries when ON, omit the section too.
With it ON, follow [Domain modeling](shared/domain-docs.md) for the entries
and ADR drafts in the template below.

```markdown
## What
<the change, in the user's domain language>

<insert the command-rendered Done when, Scope and Verify sections>

## Confirmed
- <each product decision with its gist and reason; omit this section when empty>

## Notes for the builder
<essential constraints or a chosen prototype branch>
Contracts: `<shared contract name>`, ... (only when present)

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry; omit when empty>
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft; omit when empty>

```

A `Consumes:` declaration needs a `Consumption test:` JSON line per source:
`{source,test,output,input}`: exact reference, named test case, producer shape or
producer golden fixture, and consumer public input. Gate completeness enforces it.
