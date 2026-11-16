# Prove it

Build first, then prove the change works. Use existing glossary and ADRs for
domain vocabulary and constraints. Choose seams from the brief, existing tests
and project conventions.

1. Build the change the brief describes.
2. Prove it by running it:
   - For a bug, reproduce the failure before the change and show it gone after.
   - For a feature, drive it through the app, a command or the public
     interface, and observe the behaviour the brief asks for.
3. Add a test only where [Which tests to keep](#which-tests-to-keep) keeps one.
   Run each new test against the code without the change and see it fail for
   the expected reason, then pass with the change. Test behaviour through
   public interfaces, as in [examples](test-first-tests.md) and
   [mocking](test-first-mocking.md).
4. Run the repository's checks.
5. State in the report how you proved the change and which tests you added.

Work test-first instead, per [Test first](test-first.md), for a bug that was
silent or costly to find when a fast local test can reproduce it: write the
failing test before the fix.

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
