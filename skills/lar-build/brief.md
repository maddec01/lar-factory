## 3. Brief

Write the brief to a file, then save it in the record with
`lar-work set-body <work ID> --revision N --body brief --file <file>`. The
user's original text stays in the record's initial context.

Read the local [domain-doc setting](shared/domain-docs.md#where-domain-docs-live)
before drafting. With it OFF, write `none` under Domain docs and create no drafts.
With it ON, use the entries and ADR drafts in the template below.

The whole brief may become the ticket description. Write for the team reviewing
the result: observable behavior, acceptance criteria and necessary constraints.
Keep delegation, approval evidence, work IDs and factory workflow mechanics in
local records. Notes for the builder holds only constraints or prototype evidence
that cannot be recovered from the code; omit source-file tours, line numbers and
implementation recipes. Omit empty optional sections. Aim for one screen for
routine work.

```markdown
## What
<the change, in the user's domain language>

## Done when
- <observable result a reviewer can check>

## Confirmed
- <each assumption the user confirmed, and each decision with its gist>

## Notes for the builder
<essential constraints or prototype evidence, only when needed>

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry>, or "none"
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft>, or "none"

## Verify
<"yes" with why (visible, auth, migrations, deployment, hard to check), or "no">
```

Run [Gate](gate.md) on the final text. With Spec writing ON, the whole passing
brief becomes the ticket's main description, retaining its prior text as
Original. Follow [Ticket Specs](shared/issue-tracker/work-records.md#ticket-specs).
