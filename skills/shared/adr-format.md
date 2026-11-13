Ported from mattpocock/skills (skills/engineering/domain-modeling/ADR-FORMAT.md); see UPSTREAM.md.

# ADR format

Use the configured ADR folder, normally `docs/adr/`. During Build, create it
only for its first ADR. Scan existing numbers and increment the highest for
`NNNN-slug.md`.

```md
# Decision title

One to three sentences stating context, decision and reason.
```

Add status frontmatter (`proposed`, `accepted`, `deprecated`, `superseded by
ADR-NNNN`), considered options or consequences only when they add useful context.

All three conditions must hold: hard to reverse, surprising without context,
and the result of a real trade-off. Examples include architecture, integration
patterns, technology lock-in, ownership boundaries, deliberate departures from
the obvious approach, hidden constraints and non-obvious rejected alternatives.
Skip easy-to-reverse, unsurprising or inevitable decisions.
