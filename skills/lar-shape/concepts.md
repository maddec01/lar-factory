# Concepts

A concept's map, decisions and builds live in its work record and the records
it owns, per [work records](shared/issue-tracker/work-records.md). Record the
kind `concept` (`lar-work update --kind concept`), then write the **map** to a
file and save it with `lar-work set-body <work ID> --revision N --body map --file <file>`:

```markdown
## Destination
<what is true when this is done>

## Decisions so far
- <shaping result needed to explain a part or relationship> (<decision title>)

## Fog
- <what we don't know yet, and can't phrase as a question yet>

## Out of scope
- <what this won't do>

## Domain docs
- <each glossary entry and ADR draft settled so far, with its decision's title>, or "none"

## Map
<Mermaid flowchart of the concept's decisions, builds and Dependencies by
title, with edges for structural dependencies. Omit Status, progress labels and
completion styling from this map. The board displays local progress separately.
Redraw it whenever the structure changes. Below it, list Dependencies and the
parts they affect. The board reads their local completion separately.>
- <need>, from <owner>, blocks <build title>
```

The user's original text stays in the record's initial context. Follow the local
[domain-doc setting](shared/domain-docs.md#where-domain-docs-live). With it OFF,
write "none" under Domain docs and in decision domain-drafts, without drafting entries.

1. Grill the user ([Grilling with docs](grilling-with-docs.md) in [SKILL.md](grilling-with-docs.md))
   only on the destination and the out-of-scope list.

   Save the proposed map and explain the parts and open questions. Continue
   within the user's authorized scope. Ask for a missing product decision or
   scope change once; reuse answers already given. The map plans investigation,
   without committing the user to implementation.

2. Make a decision record for each decision you can phrase now:
   `bash <this skill>/shared/scripts/slice.sh <concept work ID> "<title>" <file> --kind decision [--blocked-by <work ID>]...`,
   where the file's first line is `Method: grill`, `prototype`, `research` or
   `task`, followed by the question. Set each to Queued with `status.sh`; the
   rest stays in Fog.
3. Start each research decision now, in the background, with the
   [research](research-question.md) step.
4. Keep the concept in Shaping while decisions are open. Each grill,
   [prototype](prototype-question.md) or task decision waits in Queued for the
   board's Start, which opens its **decision thread** in its repository
   project's root with `/lar-shape <work ID>`. A blocked one starts only once
   each of its blockers is complete, by hand or through the board's Start
   after. Research decisions get no thread. Tell the user in chat which
   decisions wait on which; this shaping thread is done.

## Decisions

Work a decision record by the method its text names (**Grilling with docs** in
[SKILL.md](grilling-with-docs.md), prototype per
[SKILL.md 2. Size up](size-up.md), research findings, or a small task). Then,
in this order, so completion reads it as complete:

1. Save the confirmed answer (`lar-work set-body <work ID> --revision N --body answer --file <file>`)
   and, with domain docs ON, the drafts it settled, or "none"
   (`--body domain-drafts`). With domain docs OFF, save "none" and create no drafts.
2. Turn fog that cleared into new decision records, as in step 2. When part of
   the destination is fully decided, make a build record for it
   (`slice.sh <concept work ID> "<title>" <brief file> --kind build`) with a
   brief ([3. Brief](brief.md)) whose Domain docs copies the map entries that
   build needs, run the [gate](gate.md) and set it Ready.
3. Save the concept's map. Put only results needed to explain parts or
   relationships in Decisions so far; keep the full answer in the decision
   record. Copy its drafts into Domain docs, remove cleared fog and redraw the
   Map. Once no Fog is left, record it with
   `lar-work set-fog <concept work ID> --revision N --fog gone`.

After saving a structural change, follow
[Tracker structure sync](shared/issue-tracker/publication.md). Sync does not
require passing build gates or a commitment to implement. Ordinary decision
answers and domain drafts remain local.

Start each new research decision at once, as in step 3; every other new
decision waits in Queued as in step 4, and each build in Ready for the board's
Start build ([5. Start the build](start-build.md)). `lar-work completion` on
this decision should now print it complete; fix what its reasons name. Map
builds follow the build rules: each changes one repository, and work in another
repository becomes a build there or a Dependency per
[Other repositories](shared/issue-tracker/work-records.md#other-repositories).
A blocked build starts once its blockers are complete and the user has marked
each Dependency holding it met. The concept is complete once its Fog is gone and
every decision and build it owns is complete
([Completion](shared/issue-tracker/work-records.md#completion)).
