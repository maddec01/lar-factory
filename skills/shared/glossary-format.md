Ported from mattpocock/skills (skills/engineering/domain-modeling/GLOSSARY-FORMAT.md); see UPSTREAM.md.

# Glossary format

Use the configured path. A context has a title, one or two sentences explaining
why it exists, and a Language section:

```md
# Ordering

Receives and tracks customer orders.

## Language

**Order**:
A customer's request for specified goods.
_Avoid_: Purchase, transaction
```

Choose one canonical name and list avoided synonyms. Define what each concept
IS in one or two sentences. Include only project-specific concepts, not general
programming terms or implementation details. Group natural clusters under
subheadings; otherwise keep the list flat.

A root `GLOSSARY-MAP.md` lists each context's glossary path, purpose and
relationships, including direction and exchanged events or shared types. Follow
it when present. Otherwise use one root glossary, created lazily for its first
term during Build. Infer the relevant context; ask when unclear.
