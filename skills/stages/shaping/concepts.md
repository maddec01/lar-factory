# Concepts

Input: confirmed destination, boundaries and child records. Output: saved map,
queued decisions and recorded research associations. Read
[Structure](shared/issue-tracker/structure.md) when creating parts.

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
```

The board generates the graph from the parts' records, blockers and recorded
Dependencies. Never write nodes, edges, statuses or queue flags into map prose;
record those facts with `lar-work` instead.

The user's original text stays in the record's initial context. Follow the local
[domain-doc setting](shared/domain-docs-setting.md). With it OFF,
write "none" under Domain docs and in decision domain-drafts, without drafting entries.

1. Grill the user ([Grilling with docs](grilling-with-docs.md))
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

After group changes, follow [Reconcile group](shared/reconcile-group.md) before ending.

## Decisions

A decision thread reads [Decisions](decisions.md), then only its named method.
