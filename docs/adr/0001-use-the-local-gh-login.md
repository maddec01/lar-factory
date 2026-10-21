# Access GitHub through the local gh login

The factory is public but its local board can access private repositories, so
the [recorded plan](../plan.md#phase-2-the-mux-factory-repo-and-skills) keeps
secrets out of the repository and uses the local `gh` login for GitHub access.
This remains the rule in [AGENTS.md](../../AGENTS.md), and the
[board instructions](../../board/README.md) and
[GitHub adapter](../../board/src/github.ts) confirm that reads, issue creation
and project status writes use that same login.
