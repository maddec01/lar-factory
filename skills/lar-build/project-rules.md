# Project rules

Honor existing project instructions and coding conventions. Read applicable
`AGENTS.md` or `CLAUDE.md` files when present, plus relevant contributor docs,
formatting rules, commit conventions and PR templates. They are optional input,
not a prerequisite for shaping or building. Factory guidance travels in the
thread and subagent prompts. Do not offer repository setup, guidance files or a
setup PR.

When instructions are absent, infer conventions from neighboring code and
existing tests. Inspect package scripts, manifests and CI to select test,
typecheck, lint and build commands. Use those commands under Checks below
where later steps say "project checks". A full check suite means the applicable
project suite discovered here, limited to checks the diff can reach. Project
requirements remain binding. Missing instructions never block work.

Take extra coding guidance from the project skills selected for this build.
`lar-work read <build work ID> | jq -r '.skills[]'` prints the Start build snapshot.
Read only the relevant sections you have not already seen. The repository's
conventions take precedence over lar-build's fallback style and test process.

Continue within the user's authorized scope. Ask only about a real unresolved
conflict, such as a rule demanding a push to main, or a PR check requiring a ticket
this build lacks. Show both requirements with their sources and a concrete way
forward per [questions](shared/questions.md). Do not repeat an approval already
given in the session.

Read the local domain-doc setting per
[where domain docs live](shared/domain-docs.md#where-domain-docs-live).

## Checks

While writing code, run focused tests on what changed, plus typecheck and lint
when they take seconds. The builder's full check step runs whole suites once
per build. That run meets project instructions asking for a suite on each
change. Another agent may run a broad check earlier only by naming what focused
tests cannot catch. A failed check counts as a run; its fixer reruns that check
alone. Commit hooks still run.

Run a build only when opening the app or running a focused test needs it, and
only when the code changed since the last build or no build exists yet. No agent
runs a build as a check, except a project check that is itself a build still
runs at the full check step, in the approver's checks and when rerunning a failed
check.

### Heavy commands

A **heavy command** is a whole test suite (one package's or the root's), a
production build, a performance measurement, or anything you expect to take
over about a minute. Focused tests on named files, typecheck and lint count
only when you expect them to take that long. Servers and watchers never count.
The machine runs a limited number of heavy commands at once, across all builds
and worktrees.

`run-check` waits for a free slot itself. Run every other heavy command as
`lar-work heavy -- <command>`, which waits for a free slot and then runs it.
The wrapper runs the command's words without a shell, so a compound command
goes through `sh -c`. Give each independent heavy command its own wrapper; one
wrapper starts one job. A heavy command started inside a wrapped one runs
without waiting, and that covers only the wrapped command's own children.

Top-level threads run heavy commands, `run-check` included, in the background,
or with the longest timeout their tool allows where it has no background mode.
Delegated roles run them in the foreground with their tool's longest timeout,
per [Wait for delegated work](shared/orchestration.md#wait-for-delegated-work).
Time spent waiting for a slot counts toward a foreground tool's timeout.

## Base branch

Resolve the build's base branch before creating its worktree. Use an existing
PR's target when continuing that PR, or an explicit target in the brief.
Otherwise use the remote's default branch. Read `refs/remotes/origin/HEAD`,
refreshing it with `git remote set-head origin --auto` when absent. Keep the
resolved name as `base_branch` and pass it to implementers, reviewers and the
approver. Substitute it in every diff, rebase and PR target below. Never assume
a repository's default branch is named `main`.

## Validation record

Before running or reusing a package-wide or wider check, read
`lar-work checks <work ID>`. Implementers, the Small build builder, Fixers,
the CI fixer and later roles run broad checks through
`lar-work run-check <work ID> --role <role> [--live] [--reason <reason>] -- <command>`.
Run it in the check's folder. Focused tests on named files stay outside the
record. These rules do not require additional implementer checks.

Keep the checkout free of edits while validation runs. Only a recorded pass
with stable, available start and end trees is evidence. Interrupted or
unfinished runs stay visible and must be rerun; they are not failures.
Never reuse a run known to overlap temporary edits, even if its trees match.
A missing record is no evidence. If the tested tree object is gone, rerun.
Trees exclude ignored files, including installed dependencies and built assets,
and installed tools. Rerun affected checks when you know these changed or
when a check reads stale built assets, even on an identical tree.

For a non-live pass, inspect the diff from its tested tree to the current tree.
Record justified reuse with
`lar-work reuse-check <work ID> --check <check ID> --role <role> --reason <reason>`.
Match the applicable list by exact command and folder. A live result counts
for another role only on the identical tree within 24 hours of its end;
never use `reuse-check` for it. Rerun expired live checks.

Before retrying a failed run, the agent that saw it names the failing tests
and adds a short diagnosis with `lar-work describe-failure <check ID> --file <file>`.
Use the command's help for the file format. Diagnostic retries target those
tests. After a fix, rerun the failed check, even if broad, without repeating
unrelated suites. A later pass does not close the failure.
The builder owns every open failure and makes one diagnosis attempt, using
the Fixer when helpful. Close a failure only with a cause or fix, using
`lar-work resolve-failure <check ID> --reason <reason>`.
A check that still fails stops the build. Only a failure that later passed
with no cause found may reach the PR as open.

### Reviewer checks

Code, security and performance reviewers read the validation record before
checking. Before a broad run, record its reason with `run-check --reason`:
no result covers the reviewed tree, a named reuse reason is disputed, or a
concrete concern needs that check. State which reason applies and use the
narrowest command that answers it. Focused tests remain free. Leave the
worktree as you found it. The UI reviewer still runs no test suites.
