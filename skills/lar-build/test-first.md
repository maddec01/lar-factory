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

Write each cycle's test only where [Which tests to keep](#which-tests-to-keep)
keeps one; prove other cycles by running the change. When the slice passes,
delete each cycle test that a kept test covers, and each one the rubric would
not keep.

## Which tests to keep

Every test costs CI time and upkeep. Keep a test only when its failure would be
silent or costly and nothing else would catch it:

- Data: loss or corruption, persistence, migrations, reopen and restart
  recovery.
- Security guards: auth, sessions, roles and permissions, path, origin and
  redirect checks. Write one test per guard, not one per variant.
- One happy path per feature, endpoint group or job, through the highest seam
  that still runs fast.
- External contracts: an API document, or a file or wire format another system
  reads.
- Regressions for a bug that was silent or expensive to find.

Leave everything else to types, the framework, review, and production errors
and user reports. Add no tests for:

- validation and boundary variants, or several variants of one behaviour;
- wording, formatting and layout;
- what the type system or a library already guarantees;
- mocks that restate the code;
- timing and pacing;
- a helper that a kept test already runs.

Keep each test light:

- Use a fake clock instead of sleeps.
- Wait on a condition, not a fixed delay.
- Use the smallest fixture that still crosses the real threshold.
- Use a local fake, not a real process or network.

A test that takes more than a few seconds needs a stated reason in the test or
its commit message.
