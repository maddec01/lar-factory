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

   Then run a [launch check](SKILL.md#5-start-the-build) listing the
   destination, each planned decision with its method and blocked-by, the
   research to start, and the decision threads with their T3 projects as §5
   shows them. The map body and label setup may come first; nothing else
   changes before Go. On Adjust, update the planned map and ask again. If Pedro
   drops the concept, restore the body from Original issue and go back to
   [2. Size up](SKILL.md#2-size-up).

2. Create a sub-issue for each decision you can phrase now, labelled
   `decision: grill`, `decision: prototype`, `decision: research` or
   `decision: task`, with blocked-by links where one needs another
   ([native relationship commands](issue-tracker.md#native-relationships)).
   Put them in Queued; the rest stays in Fog.
3. Start each `decision: research` now, in the background, with the `research`
   skill. Findings go on a `research/<n>-<slug>` branch linked from the
   sub-issue.
4. Keep the map in Shaping while decisions are open. For each unblocked
   `grill`, `prototype` or `task` decision, launch a **decision thread** with
   `t3_thread_launch` in its repo's T3 project (cloned as in
   [5. Start the build](SKILL.md#5-start-the-build) if needed), with
   `workspaceStrategy` `{"type":"root"}` and message `/mux-work <owner/repo#n>`.
   Research decisions get no thread; blocked ones stay Queued.

## Decisions

Work a decision sub-issue by the method its label names (**Grilling with
docs** in [SKILL.md](SKILL.md#grilling-with-docs), prototype, research findings,
or a small task). Then comment the answer with any Domain docs drafts it
settled, add its gist to the map's Decisions so far and its drafts to the map's
Domain docs, and turn fog that cleared into new decision sub-issues. When part
of the destination is fully decided, create a `build` sub-issue for it with a
brief ([3. Brief](SKILL.md#3-brief)) whose Domain docs copies the map entries
that build needs, run the [gate](SKILL.md#4-gate) and set it Ready. If this
unblocked or created any decisions or builds, run one launch check on this
sub-issue for them; on Go, launch the decisions as in step 4 and the builds by
step 2 of [5. Start the build](SKILL.md#5-start-the-build). Then close it and
redraw the map. Map builds follow the
build rules: each changes one repository, and work in another becomes a build
there blocking it ([2. Size up](SKILL.md#2-size-up)); all start at once, and
once the Fog is gone the last to merge closes the map
([Parent closing](issue-tracker.md#parent-closing)). The decision that clears
the last Fog closes the map itself if every build has merged.
