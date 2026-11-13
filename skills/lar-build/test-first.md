Ported from mattpocock/skills, `skills/engineering/tdd/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md).

# Test first

Apply these rules during every red/green cycle. Use existing glossary and ADRs
for domain vocabulary and constraints. Test behavior through public interfaces
so tests survive internal refactors and read as capability specifications.
Read [examples](test-first-tests.md) when choosing assertions and
[mocking](test-first-mocking.md) when choosing substitutes.

Choose seams from the brief, existing tests and project conventions. State what
tests cover and leave unchecked, reusing shaping decisions. A routine test plan
needs no approval; ask only about unresolved behavior or scope. If the interface
itself needs design, read [Design modules](design-modules.md) as reference.

Avoid tests of private methods, internal collaborators, call order/counts or
side channels such as querying the database instead of using the interface.
Expected values come independently from the spec, a worked example or a known
good literal, never by repeating the implementation's calculation.

Work vertically: one seam, one failing test, enough implementation to pass,
then the next cycle informed by what you learned. Do not write all tests before
all implementation, anticipate future tests or add speculative features.
Refactoring belongs to review, outside this red/green cycle.
