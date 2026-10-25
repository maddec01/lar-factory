# Concepts

Run [label setup](issue-tracker.md#label-setup) for the map's repository before
creating or labelling the map and its sub-issues. For a sub-issue in another
repository, select that destination explicitly, as the guide shows.

The issue becomes the **map**, labelled `concept`, with this body:

```markdown
## Destination
<what is true when this is done>

## Decisions so far
- <gist> (#n)

## Fog
- <what we don't know yet, and can't phrase as a question yet>

## Out of scope
- <what this won't do>

## Domain docs
- <each glossary entry and ADR draft settled so far, with its decision (#n)>, or "none"

## Map
<Mermaid flowchart of the sub-issues: decisions and builds, edges for
blocked-by, closed ones styled done. Redraw it whenever a sub-issue changes.>

<details><summary>Original issue</summary>

<the issue's original body>
</details>
```

1. Grill Pedro (**Grilling with docs** in [SKILL.md](SKILL.md#grilling-with-docs))
   only on the destination and the out-of-scope list.

   Then ask Pedro to confirm the planned map as an ordinary
   [question](questions.md) ("Confirm" / "Correct it"), listing the
   destination, each planned decision with its method and blocked-by, and the
   research to start. The map body and label setup may come first; nothing
   else changes before he confirms. On a correction, update the planned map and
   ask again. If Pedro drops the concept, restore the body from Original issue
   and go back to [2. Size up](SKILL.md#2-size-up).

2. Create a sub-issue for each decision you can phrase now, labelled
   `decision: grill`, `decision: prototype`, `decision: research` or
   `decision: task`, with blocked-by links where one needs another
   ([native relationship commands](issue-tracker.md#native-relationships)).
   Put them in Queued; the rest stays in Fog.
3. Start each `decision: research` now, in the background, with the `research`
   skill. Findings go on a `research/<n>-<slug>` branch linked from the
   sub-issue.
4. Keep the map in Shaping while decisions are open. Each `grill`,
   `prototype` or `task` decision waits in Queued for the board's Start, which
   opens its **decision thread** in its repository project's root with
   `/lar-work <owner/repo#n>`. A blocked one starts only once every issue it's
   blocked by closes, by hand or through the board's Start after. Research
   decisions get no thread. Tell Pedro in chat which decisions wait on which;
   this shaping thread is done.

## Decisions

Work a decision sub-issue by the method its label names (**Grilling with
docs** in [SKILL.md](SKILL.md#grilling-with-docs), prototype per
[SKILL.md 2. Size up](SKILL.md#2-size-up), research findings, or a small
task). Then comment the answer with any Domain docs drafts it settled, add its
gist to the map's Decisions so far and its drafts to the map's Domain docs, and
turn fog that cleared into new decision sub-issues. When part of the
destination is fully decided, create a `build` sub-issue for it with a brief
([3. Brief](SKILL.md#3-brief)) whose Domain docs copies the map entries that
build needs, run the [gate](SKILL.md#4-gate) and set it Ready. Start each new
`decision: research` at once, as in step 3; every other new decision waits in
Queued as in step 4, and each build in Ready for the board's Start build
([5. Start the build](SKILL.md#5-start-the-build)). Then close this sub-issue
and redraw the map. Map builds follow the
build rules: each changes one repository, and work in another becomes a build
there blocking it ([2. Size up](SKILL.md#2-size-up)); a blocked build starts
once its blockers close, and once the Fog is gone the last to merge closes the map
([Parent closing](issue-tracker.md#parent-closing)). The decision that clears
the last Fog closes the map itself if every build has merged.
