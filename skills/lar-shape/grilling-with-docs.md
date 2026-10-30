# Grilling with docs


Wherever this skill grills (open questions in **2. Size up**,
[Concepts](concepts.md) step 1, `decision-grill`), load [grilling](skills/grilling/SKILL.md) and
[domain-modeling](shared/skills/domain-modeling/SKILL.md), as upstream `grill-with-docs` does. Challenge the user's terms
against the repo's `GLOSSARY.md` and ADRs; capture each resolved term and
ADR-worthy decision the moment it settles.

Shaping, concept and decision threads run in the issue's repository project
(the T3 project on its repo's main checkout) with no
branch or PR, writing only to the issue and leaving the checkout as found. So
draft each glossary entry and ADR instead of writing it: record it in the
batch's answers comment, then in **Domain docs** of the brief (**3. Brief**) or
the map ([Concepts](concepts.md)). Drafts follow [domain-modeling](shared/skills/domain-modeling/SKILL.md)'s
`GLOSSARY-FORMAT.md` and `ADR-FORMAT.md`; an ADR draft meets its three
conditions. The builder writes them to the repo in the build PR.

