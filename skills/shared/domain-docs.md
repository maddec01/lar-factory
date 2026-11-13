Ported from mattpocock/skills (skills/engineering/domain-modeling/SKILL.md); see UPSTREAM.md.

# Domain modeling

Read the [domain-doc setting](domain-docs-setting.md). Existing glossary/ADRs
remain context even when writing is OFF. Use configured paths. If a root
`GLOSSARY-MAP.md` exists, follow its context paths and system/context ADRs;
otherwise use the root glossary and configured ADR folder. Create files only
during Build when the first entry is needed.

Challenge language that conflicts with the glossary immediately. Propose a
canonical term for vague or overloaded words. Test relationships with concrete
edge cases. Check claims against code and ask about contradictions rather than
silently picking one interpretation.

With docs ON, save each resolved term using [Glossary format](glossary-format.md)
and each qualifying decision using [ADR format](adr-format.md). Shaping, concept
and decision threads draft in work records, leaving the checkout unchanged.
Save a decision's `domain-drafts` with `set-body`, then include them in the
brief/map's Domain docs. Build writes them in its PR. Origin citations use a
published ticket or the build PR, never a work ID or local path. With docs OFF,
Domain docs and domain-drafts say "none"; create no drafts or files.

Glossaries define project language, not implementation details, specs or notes.
Draft an ADR only for a decision that is hard to reverse, surprising without
context AND the result of a real trade-off. Otherwise skip it.
