# Project rules

Read applicable existing project instructions, contributor docs, conventions
and PR templates. When absent, infer from nearby code/tests and scripts, manifests
and CI. Missing guidance never blocks work; offer no setup/guidance files or PR.
Project conventions override lar fallback style and tests. Read the relevant
selected skills from the build record's `skills` snapshot, once.

Continue authorized work. For a genuine conflict, show both requirements and
sources with a concrete option through [Questions](shared/questions.md).
Do not repeat approval already given. Read existing glossary/ADRs for context.
Planner and implementer leave the brief's domain drafts to the builder's docs
role. Domain authors load [Domain modeling](shared/domain-docs.md) and its setting.
Reviewers get the saved setting/paths: OFF requires "none"; ON requires consistent
terms and ADRs only for hard-to-reverse, surprising, real trade-offs. Load
[glossary](shared/glossary-format.md) or [ADR](shared/adr-format.md) formats only
when checking those drafts.

## Checks

Run every Node test through `lar-work run-test ID --role ROLE -- COMMAND`;
for broad tests add `--record` (and any live/reason flags). The system freezes
its runtime at run start for every role and slice. A mismatch holds tests with
a reason; never register, change or ask about runtimes. Non-test checks use
`run-check` below.
During edits, run focused tests, plus typecheck/lint when they take seconds.
The full-check stage runs applicable whole suites once, limited to what the diff
can reach, satisfying per-change suite rules. Required project checks and hooks
remain binding. An earlier broad run needs a named concern focused tests cannot
catch. A failed check counts as a run; rerun that check, not unrelated suites.

Build only to open the app or run a focused test, and only if code changed or no
build exists. Exception: a build listed as a project check runs at full-checks,
approver assessment and failed-check retry.

### Heavy commands

Whole suites, production builds, performance measurements and commands expected
to exceed a minute are heavy. Focused tests/typecheck/lint count only above that
threshold; servers/watchers never do. Wrap each independent heavy job separately
with `lar-work heavy -- <command>`. It executes words without a shell; compound
commands require `sh -c`. Nested work is covered only within that job.
`run-check` obtains its own slot. Top-level threads use background execution or
the longest available timeout; roles use foreground and the longest timeout per
[Wait for delegated work](shared/orchestration.md#wait-for-delegated-work).
Slot waiting counts toward timeout.

## Base branch

Use the existing PR's target, an explicit brief target, or the remote default,
in that order. Read `refs/remotes/origin/HEAD`; refresh a missing ref with
`git remote set-head origin --auto`. Resolve before worktree creation and pass
`base_branch` to roles for every diff, rebase and PR. Never assume `main`.

## Validation record

Before broad runs/reuse, read `lar-work checks ID`. Run package-wide or broader
checks in their folder with `run-check ID --role ROLE [--live] [--reason WHY]
-- COMMAND`. Focused named-file tests remain outside the record; this requires
no extra implementer runs.

Keep the checkout unedited during validation. Only a recorded pass with stable,
available start/end trees is evidence. Missing records, lost tree objects and
interrupted/unfinished runs require rerun; interruption is not failure. Never
reuse a run known to overlap temporary edits, even if trees match. Rerun affected
checks after dependency, tool or built-asset changes; trees exclude ignored files
and cannot establish their validity.

For a non-live pass, inspect the tested-to-current diff and record a reason using
`reuse-check ID --check CHECK --role ROLE --reason WHY`. Match list entries by
exact command and folder. Live results count for another role only on the
identical tree within 24 hours of completion; never use `reuse-check` for them.
Rerun expired live checks.

Before retrying failure, name failing tests and save diagnosis with
`describe-failure CHECK --file F`; command help owns its format. Diagnostic
retries target those tests. After a fix, rerun that failed check even if broad.
A later pass alone never closes it: `resolve-failure CHECK --reason WHY` requires
a cause or fix. The builder owns open failures and makes one diagnosis attempt,
using Fixer if useful. Still failing stops the build. Only a later pass with
unknown cause may reach the PR as an open failure.

### Reviewer checks

Code/security/performance read validation first. Before a broad run, record a
reason: no covering result, a disputed reuse reason or a concrete concern.
Use the narrowest answering command. Focused tests remain free. Leave the
checkout as found. UI runs no test suites.
