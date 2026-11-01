# Workflow boundary checks

`workflow-fixtures.ts` holds two disposable repositories. Each one exists only
as fake gh or az state and a temporary checkout, so `pnpm test` never reaches a
real repository.

- `NO_FACTORY_FILES` is a GitHub repository with no `.lar-factory.json`, no
  `## Agent skills` section, no `docs/agents/` and no domain docs.
- `AZURE_WITH_PROJECT_RULES` is an Azure DevOps repository with existing project rules. Its `AGENTS.md` has
  project rules and an old `## Agent skills` section, and it has
  `docs/agents/issue-tracker.md` and one project skill.

`workflow-boundary.test.ts` onboards the first fixture, captures work with
`lar-work` and starts it, and asserts that gh made no write. It also detects the
second fixture through `fakeAzRepos` and asserts that az pushed nothing.
`restart.test.ts` restarts the board after a `lar-work` write and after a start
whose outcome was a success, a failure or uncertain. It asserts that T3 is read
before any retry and that a board never starts a second thread for one
unresolved start.

## Live checks for the builder

The fake t3 can't run an agent, so run each of these in both Claude Code and
Codex through T3, and report each one as passed, failed or not run:

1. Start a shape and a build on a work record in a disposable repository with
   no factory files. The thread resolves the work ID with `work.sh` and writes
   progress only with `lar-work`.
2. Start in a checkout with existing project rules, with project `AGENTS.md` or `CLAUDE.md` rules.
   The thread keeps the project's checks, commit format and PR rules.
3. Hand off from lar-shape to lar-build, and delegate an implementer task from
   lar-build. The brief names the work ID, and the child reads the same
   database as its parent.
4. Write with `lar-work` from a thread while the board is closed, then open
   the board. It shows the write.
5. Stop T3 Code during a Start, then restart the board. The board reads T3
   before any retry and shows one thread or Needs you, never two threads.
6. Read each agent's native startup instructions in a thread. Confirm that
   project instructions still load next to the factory guidance.

## Known limitations

- The factory can't remove a provider's native startup context or turn off its
  native skills. Checks 2 and 6 record what loaded and claim nothing more.
- The tests detect the Example App fixture's teams from a stub, because
  `fakeAzRepos` doesn't answer team reads.
- The tests don't run the 60-second grace before an absent thread sets Needs
  you. `item-commands.test.ts` covers it with a stubbed clock.
- The tests don't exercise a real T3 timeout followed by a late launch, a
  thread deleted during recovery, or a real gh or az refusal.
