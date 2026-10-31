<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/lar-factory-on-dark.png">
    <img alt="Lar Factory" src=".github/assets/lar-factory-on-light.png" height="56">
  </picture>
</p>

# Lar Factory

A local software factory for any repository. Shape issues and ideas, keep the
work on a board, and build chosen changes through review to a PR. You decide
what to build and merge every PR.

## Get started

Install the Mac app from [GitHub Releases](https://github.com/maddec01/lar-factory/releases)
and open it with T3 Code running. In Settings > Repositories, choose Add repository:

1. Choose a repository from your T3 Code projects.
2. Choose its issue source, domain docs and tracker sync. GitHub uses repository
   issues; Azure DevOps uses a team's backlog and current sprint together.
   Domain docs are OFF by default. Tracker structure sync is ON by default.
3. Review access and add the repository. The saved access choices apply to later
   work, so routine actions need no repeated permission prompt.

The configured source supplies the repository List. There is no per-ticket
import step, setup PR or repository configuration to merge. The factory neither
reads nor writes nor detects `.lar-factory.json`, and never offers it. Existing
project instructions are optional. The factory honors project conventions and
uses package scripts, manifests, CI and nearby tests when instructions are absent.

## Shape first, build when ready

Add an idea to List or open an issue there. Queue work when you want to shape it,
then choose Start. Shaping reads the issue and code, investigates uncertainties,
and asks you for missing decisions. It produces a Ready brief or a concept map
with parts and relationships. Any issue can be shaped independently of a build.
Ready commits you to no implementation.

Choose Start build later for a Ready item you want implemented. It opens an
isolated worktree, plans and builds the change, runs project checks and reviews,
and opens a PR. Visible or risky work goes to Verify with steps for you to check;
otherwise it goes to Ready to merge. You merge it. Needs you means the work is
waiting for a decision, an answer or verification.

Work records keep ordinary progress on this machine, including queue, board
Status, brief, decisions, slices, threads and review results. Tracker sync never
writes queue, board Status, workflow stage or per-item progress to a tracker.

## Tracker structure sync

The ON-by-default onboarding option saves concepts and multi-repository structure
only. It saves kind, map diagram, parts, Connections between repositories,
Dependencies on other owners, and which issues belong together. It includes only
shaping results necessary to explain that structure. Ordinary briefs, decision
records, domain drafts, slices and progress stay local. Turning sync OFF keeps
structure local too and causes no later publish prompt.

Local structural changes enter an outbox that drains automatically while sync is
ON. `lar-work sync-structure <work ID>` requests structural sync explicitly.
The app saves this local option as `settings.structureSync`. The local-settings
helper also accepts `progressSync` as a compatibility spelling. Both mean
structural sync only.

On a fresh installation, add the repository and add the saved concept or
multi-repository work from List. This restores kind, map, parts and relationships,
including Connections and Dependencies. Queue and Status start fresh. Tracker
sync does not restore ordinary briefs, decisions, slices or build progress.

## Domain docs

One local `domainDocs` setting controls glossary and ADR writes. OFF is
`{ "kind": "private" }`. Terms and decisions stay in local work records; builds
write no domain docs and never ask to publish them later. ON is
`{ "kind": "repository", "glossary": "GLOSSARY.md", "adrs": "docs/adr" }`.
Builds include the relevant glossary entries and ADRs in their build PR, creating
files only when needed. Shaping itself leaves repository files unchanged.

## Local data and commands

The app and `lar-work` share `~/Library/Application Support/Lar Factory/`.
`repository-settings.json` holds the repository list, local settings, access
choices and Connections. `work-records.db` holds work records and their
bodies. An absolute `LAR_FACTORY_DATA_DIR` selects another data folder. Repository
settings stay on this machine and use your existing local `gh` or `az` login;
no factory infrastructure or credentials are required.

The app installs `lar-shape`, `lar-build` and the `~/.local/bin/lar-work` launcher
for your agents. Put `~/.local/bin` on PATH to use the command from any folder,
with the board open or closed. `lar-work --help` lists its commands. Factory
instructions travel with threads; target repositories need no factory setup or
guidance files. Existing project skills selected for a build supply extra coding
guidance.

[Work records](skills/shared/issue-tracker/work-records.md) describes the workflow
commands. [UPSTREAM.md](UPSTREAM.md) credits Copies and Ports. Copies update through
this checkout's `/skill-sync`; lar-owned steps can change directly.

## Develop the app

Use Node 24.15+ and pnpm from the repository root:

```bash
pnpm install
pnpm run dev
```

The first install downloads Electron. The workspace contains the server, web UI,
Electron app and shared packages. See [the server README](apps/server/README.md)
for local server and sample commands, and [the skill layout](docs/skill-layout.md)
for assembly.

To build an unsigned Apple Silicon app:

```bash
cd apps/desktop
pnpm run build --unsigned
```

The app, dmg and zip go into `apps/desktop/release/`. A signed release uses the
maintainer's signing secrets and the Release workflow.

### Release secrets

The Release workflow signs and notarizes the board app with the maintainer's Developer ID, and
it fails without the signing secrets. Run the wizard once before the first Release,
and again when the certificate or the API key changes:

```bash
bash scripts/release-secrets.sh
```

It walks the Apple Developer and App Store Connect pages, then creates the `release`
environment (main only) and stores the secrets in it with `gh`. It stops unless `gh`
is logged in as an admin of the repo. Add `--dry-run` to see the `gh` commands
without running them.

### Releasing

The maintainer starts every Release by hand. Open Actions > Release > Run workflow on main
and pick a channel, `nightly` (the default) or `stable`. Tick `dry_run` to build,
sign and notarize without publishing.

A Nightly builds main's head as a prerelease tagged like
`v0.1.0-nightly.20261023.57`. Its version comes from `apps/desktop/package.json` at that
commit. It publishes only if CI's run for that commit on a push to main passed. It
fails when that run failed or hasn't finished, and publishes nothing when the commit
already has a Nightly.

A Stable Release rebuilds the latest Nightly's commit as `v<version>` and marks it
the latest Release. It fails if that tag exists or main doesn't contain the commit.
To ship one:

1. Bump `version` in `apps/desktop/package.json` and merge it.
2. Start a Nightly and wait for it to publish.
3. Start a Stable Release.

One Release run goes at a time. A run started while another is running waits for
it, and GitHub keeps only the newest waiting run, so starting a third run replaces
the waiting one. If a run shows as canceled, run it again.

## Repo layout

```text
skills/               lar-shape, lar-build and shared workflow source
.agents/skills/       checkout-only skill-sync
apps/server/          local board server and provider adapters
apps/web/             board UI
apps/desktop/         Electron app
packages/shared/      shared model and local settings
packages/ui/          design system
packages/work-records/ local work records and lar-work command
scripts/              assembly, workspace setup and release tools
```

## Credits and licence

MIT, see [LICENSE](LICENSE). The copied skills and code come from:

- [Matt Pocock](https://github.com/mattpocock/skills): most of the copied skills.
- [Addy Osmani](https://github.com/addyosmani/agent-skills): the review and hardening checklists bundled inside `lar-build`.
- [Lauren Tan](https://github.com/cursor/plugins/tree/main/pstack): `unslop`, from `pstack` in cursor/plugins.
- [T3 Tools](https://github.com/pingdotgg/t3code): T3 Code's desktop app, ported into the board app, and the base components in `packages/ui`.
- [coss](https://github.com/cosscom/ui): the toast in `packages/ui`, and the registry T3's base components derive from.

All five are MIT; their notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The factory idea draws on ZazenCodes'
[Build Your Own AI Software Factory](https://www.youtube.com/watch?v=ctoaIC4LHmI).
