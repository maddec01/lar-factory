# Domain docs

How to read this repository's domain docs: its glossary and its ADRs.

## Layout

Look at the repository root:

- Single-context: one `GLOSSARY.md` at the root, and ADRs in `docs/adr/`.
- Multi-context: a root `GLOSSARY-MAP.md` lists each context and the path of
  its own `GLOSSARY.md`. Each context keeps its ADRs in a `docs/adr/` beside its
  glossary, and the root `docs/adr/` holds decisions that span contexts.

A root `CONTEXT.md` or `CONTEXT-MAP.md` is the glossary or map under its old
name. When none of these exist, proceed silently; the `domain-modeling` skill
creates them when a term or decision settles.

## Before shaping or building

Read the glossary, or in a multi-context repository the glossary of each context
the work touches, and the ADRs for the area you change.

## Use the glossary's terms

Write the glossary's terms in issue titles, briefs, test names and code, and
reach past each term's _Avoid_ list to the term itself. A concept the glossary
lacks is a sign the work coins a term: note it for `domain-modeling`.

## Flag ADR conflicts

When the work contradicts an ADR, say so and name the ADR, then ask before going
against it.
