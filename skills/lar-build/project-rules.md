# Project rules

The repository's own rules come first: its `AGENTS.md` or `CLAUDE.md`, its
coding rules, checks, commit format and PR requirements. lar-build's standards
(test-first, coding style, commit steps, PR body) fill only what the project
leaves open.

Take extra coding guidance only from the project skills selected for this
build: `lar-work read <build work ID> | jq -r '.skills[]'` prints the snapshot
Start build took. Read the sections of each that bear on the change. Guidance
already in context, such as the repository's startup instructions or a skill
loaded earlier, needs no second read; read a relevant section you haven't seen.

A project workflow that differs from the factory's, such as its own branch
names, commit format or tracker, is not a Clash: follow the project. A
**Clash** is a conflict where meeting one requirement breaks the other, such as
a project rule to push to main or a PR check that demands a ticket this build
lacks. Show the user both rules with their file and line, and ask how to go on
per the [question guide](shared/questions.md). The project's instructions stay
as they are; a change to them is the user's call.

The repository may have no factory guidance: no `## Agent skills` block and no
`docs/agents/` files. Every subagent prompt carries the factory guidance its
role needs: the build's work ID, its lar-build file paths and the prose rules.
Read where domain docs live from `repo-config.sh` per
[where domain docs live](shared/domain-docs.md#where-domain-docs-live).
