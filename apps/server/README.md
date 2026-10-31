<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/lar-factory-on-dark.png">
    <img alt="Lar Factory" src="../../.github/assets/lar-factory-on-light.png" height="56">
  </picture>
</p>

# Board server

The local server serves the Lar Factory board for any onboarded repository.
Repository issue sources populate List. Queue, Status and ordinary progress live
in local work records. The default tracker-sync option saves concept and
multi-repository structure only. See [the main README](../../README.md) for
onboarding, the exact sync boundary and fresh-install restoration.

## Run locally

Use Node 24.15+ and install the workspace from its root. From `apps/server`:

```sh
pnpm start
```

`pnpm run dev` rebuilds the page and restarts the server on changes.
`pnpm run sample` uses fixtures without provider calls. Choose a free port for a
second instance with `BOARD_PORT`. The app normally uses the first free port
between 4317 and 4416; `BOARD_PORT=0` asks the OS for one.

The server commands build `apps/web` before serving its page. A process keeps
the page it started with, so rebuilding another checkout does not replace it.
The packaged Electron app starts and stops its own server.

## Repository settings

Onboarding has three steps, repository, source/docs/sync, then access/add. It
saves directly on this machine. It offers no setup PR, configuration file or
guidance changes. The source supplies List without a per-ticket import step.
Existing project conventions apply even when the repository has no agent docs.

`~/Library/Application Support/Lar Factory/repository-settings.json` stores the
repository list and settings. An absolute `LAR_FACTORY_DATA_DIR` selects another
folder. A repository entry uses `owner/name` for GitHub or
`organization/project/repository` for Azure DevOps. Its local `settings.overrides`
holds role, issue source, labels, domain docs, selected project skills and
vocabulary mappings. This retained field name has only built-in defaults beneath
it. Cached shared values are ignored, and the server reads no repository config.

`domainDocs.kind` is `private` for OFF or `repository` for ON. OFF keeps domain
drafts local without later publish prompts. ON names the glossary and ADR paths
that builds include in their PR. The tracker option is ON by default, currently
`settings.structureSync` in the app. The local-settings helper also accepts
`progressSync` as a compatibility spelling. Its scope is kind, map, parts, Connections, Dependencies and issue
grouping. It never syncs queue, board Status or ordinary progress.

`bash skills/shared/scripts/repo-config.sh <repository>` from the workspace root
prints effective local settings without a provider call. Its `--list` and
`--connections <repository>` forms read the same file. A missing file means no
onboarded repositories.

## Access and runtime

Provider access uses the local `gh` or `az` login. The server looks up `t3`, `gh`
and `az` through tool overrides, the login shell PATH and common install folders.
`T3_PATH`, `GH_PATH` and `AZ_PATH` can select a tool explicitly. Sample mode
looks up no tools. T3 Code supplies the repository projects and starts threads.

The Electron app supplies `BOARD_APP_SECRET`. Writes require its
`X-Board-Secret` header. Before updating, the app requests `/api/drain` with the
secret so running writes finish before the server stops.

Source refresh and PR observations read providers; local progress does not write
back to issues. Structural sync uses the saved local option and outbox. A fresh
installation restores a saved concept or multi-repository structure from List,
with fresh queue and Status. It does not restore briefs or build progress.

## Tests

`pnpm test` in this folder runs server tests. Unit tests sit beside their source
files; tests in `test/` start the server with fixtures. Web tests live in
`apps/web`. See the root `AGENTS.md` for checks required by a change.
