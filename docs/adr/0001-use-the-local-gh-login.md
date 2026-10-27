# Access GitHub through the local gh login

The factory is public but its local board can access private repositories, so
the [recorded plan](../plan.md#phase-2-the-lar-factory-repo-and-skills) keeps
secrets out of the repository and uses the local `gh` login for GitHub access.
This remains the rule in [AGENTS.md](../../AGENTS.md), and the
[board instructions](../../apps/server/README.md) and
[GitHub adapter](../../apps/server/src/github/github.ts) confirm that reads, issue creation
and project status writes use that same login.

The board app's updater is the one GitHub read outside `gh`. electron-updater
fetches the update feeds (`latest-mac.yml`, `nightly-mac.yml`) and the app from
lar-factory's Releases itself, without the gh login. That works because the
repository is public, and the Releases hold nothing secret.

Amended by [issue #350](https://github.com/maddec01/lar-factory/issues/350): a repository on Azure DevOps uses the local `az login` the same way, and the public repo holds no Azure secret either.
