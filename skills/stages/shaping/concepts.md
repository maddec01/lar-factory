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
<List Dependencies and the parts they affect. The board draws the live Work map
from the decision and build records, their blockers and these Dependencies. A
Mermaid flowchart is optional context, for a reader of this text only.>
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
   `bash <this skill>/shared/scripts/slice.sh <concept work ID> "<title>" <file> --kind decision --repository <owner/repo> [--blocked-by <work ID>]...`,
   where the file's first line is `Method: grill`, `prototype`, `research` or
   `task`, followed by the question. The command creates the complete part in
   Queued, with its parent and blockers; the rest stays in Fog. Name the
   repository where the decision belongs, even when it differs from the concept.
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
[SKILL.md 2. Size up](size-up.md), research findings, or a small task).
Run each heavy command (a whole test suite, a production build, a performance
measurement, or anything expected to take over about a minute) on its own as
`lar-work heavy -- <command>`. Top-level decision threads use the background,
or their tool's longest timeout where it has no background mode. Delegated
roles use the foreground with their tool's longest timeout, per
[Wait for delegated work](shared/orchestration.md#wait-for-delegated-work). Then, in this order, so completion reads it as complete:

Read siblings with `lar-work decision-answer ID`; use current text or the resolved
replacement. Within the approved destination, adjust proposed builds without asking.
If this answer supersedes another, use `supersede-answer` per
[Completion](shared/issue-tracker/work-records.md#completion) before saving the map.

1. Save the confirmed answer (`lar-work set-body <work ID> --revision N --body answer --file <file>`)
   and, with domain docs ON, the drafts it settled, or "none"
   (`--body domain-drafts`). With domain docs OFF, save "none" and create no drafts.
2. Turn fog that cleared into new decision records, as in step 2. When part of
   the destination is fully decided, make a build record for it
   (`slice.sh <concept work ID> "<title>" <brief file> --kind build --repository <owner/repo> [--blocked-by <work ID>]...`) with a
   brief ([3. Brief](brief.md)) whose Domain docs copies the map entries that
   build needs. New builds start Queued and can remain ungated. Run the [gate](gate.md)
   and set a build Ready when preparing it for implementation.
3. Save the concept's map. Put only results needed to explain parts or
   relationships in Decisions so far; keep the full answer in the decision
   record. Copy its drafts into Domain docs, remove cleared fog and update the
   Map's Dependencies. Once no Fog is left, record it with
   `lar-work set-fog <concept work ID> --revision N --fog gone`.

Start each new research decision at once, as in step 3; every other new decision
waits in Queued as in step 4. Builds remain Queued for shaping until gated
and moved to Ready for the board to start
([5. Start the build](start-build.md)). `lar-work completion` on this decision
should now print it complete; fix what its reasons name. Map builds follow the
build rules: each changes one repository, and work in another repository becomes
a build there or a Dependency per [Other
repositories](shared/issue-tracker/work-records.md#other-repositories). A
blocked build starts once its blockers are complete and the user has marked each
Dependency holding it met. Consult `lar-work refinement <concept work ID>`
independently of delivery. Refinement requires a nonempty map, Fog recorded gone
and every active decision settled. Fix its incomplete reasons. Proposed builds
need neither passing gates nor merged PRs for refinement. The user's Start build
on a child needs only the child's own gate and blockers. A Ready build waits for
the user's Start build on the board. The exception is Auto-build. With this
machine's Auto-build switch on, the board starts eligible Ready builds by
itself, up to the build limit. Auto-build starts a build under a concept only
once the concept's Refinement is complete.

Read [Completion](shared/issue-tracker/work-records.md#completion) for delivery
and [Structural publication suspended](shared/issue-tracker/publication.md)
for local structure and retained recovery data.
