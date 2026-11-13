Ported from mattpocock/skills (skills/productivity/writing-for-agents/SKILL.md); see UPSTREAM.md.

# Write agent docs

Use for skills, agent instructions and documents they reference. For skill
frontmatter and invocation, also read [Skill mechanics](skill-mechanics.md).
Aim for a repeatable process, not identical output.

A context pointer names material and the condition for loading it. Front-load
its trigger; name every distinct branch once, without synonyms or identity the
body already supplies. Sharpen a weak pointer before inlining its target.
Always-loaded pointers spend context on every turn. Separate documents also
cost human attention: keep that choice where human judgment matters.

Put ordered actions first, shared rules beside the step that uses them, and
branch-specific reference behind explicit pointers. Keep a concept's rules and
exceptions together. Split excessive text by branch or sequence, not arbitrary
length. Inline what every branch needs; disclose what only some branches need.
A flat set of peer rules can stay flat.

Give every step a checkable, exhaustive completion criterion. Sharpen a vague
bound before splitting. If observed premature completion persists, hide later
steps across a real context boundary, such as a handoff or subagent dispatch.
An inline call does not clear later steps from context. Merging sequences can
restore that temptation. Require the actual legwork, such as accounting for
every modified model, rather than merely producing an artifact.

Use familiar, precise leading words consistently in pointers and instructions.
Define invented terms. Collapse repeated definitions into a shared term only
when it still triggers the intended behavior. State the desired action;
retain prohibitions for hard guardrails and pair them with the positive action.

Keep each rule in one authoritative home. Let scripts, config, directory layout
and command help supply cheap lookups. Document conventions, reasons and traps
they cannot reveal, rather than caching their output. Remove stale or irrelevant
text and branch material loaded by the wrong role. Test suspected no-op rules
against the actual model: delete them only when runs show unchanged behavior.
People's intuition about the default is not evidence. Prefer deleting a proven
no-op sentence to shaving words from it.
