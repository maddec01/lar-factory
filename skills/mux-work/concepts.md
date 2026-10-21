# Concepts

Run [label setup](issue-tracker.md#label-setup) for the map's repository before
creating or labelling the map and its sub-issues. Use the guide's explicit
destination selection for sub-issues that belong in another repository.

The issue becomes the **map** and gets the `concept` label. Its body:

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
```

1. Grill Pedro (**Grilling with docs** in [SKILL.md](SKILL.md#grilling-with-docs))
   only on the destination and the out-of-scope list.
2. Create a sub-issue for each decision you can phrase now, labelled
   `decision: grill`, `decision: prototype`, `decision: research` or
   `decision: task`, linked with blocked-by where one needs another
   (see [native relationship commands](issue-tracker.md#native-relationships)).
   Put them in Queued. Leave the rest in Fog.
3. For `decision: research`, start the research now with the `research` skill in
   the background. Findings go on a `research/<n>-<slug>` branch; link it from
   the sub-issue.
4. Set the map to Shaping while decisions are open. Each decision runs in its own
   thread with `/mux-work <sub-issue>`.

## Decisions

Work one decision sub-issue with the method its label names (**Grilling with
docs** in [SKILL.md](SKILL.md#grilling-with-docs), prototype, research findings,
or a small task). Then comment the answer with any Domain docs drafts it
settled, close it, add its gist to the map's Decisions so far and its drafts to
the map's Domain docs, and redraw the map. Turn fog that became clear into new
decision sub-issues. When a part of the destination is fully decided, create a
`build` sub-issue for it with a brief ([3. Brief](SKILL.md#3-brief)) whose
Domain docs copies the map's entries that build needs, run the
[gate](SKILL.md#4-gate), set it Ready, and start its build
([5. Start the build](SKILL.md#5-start-the-build)). The map is done when the
fog is gone and every build has merged.
