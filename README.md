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
   Choose whether to write domain docs. Tracker structure sync is ON by default
   and creates a `linked-work` label when first used.
3. Choose issue defaults and optional vocabulary mappings, then review Access
   and add the repository. Create issues from Add item, Create issues from retro
   captures and Write the refined spec to the issue all default to ON, including
   for existing repositories. Settings lets you change them later.

Verified Access controls writes. Refused or unchecked access disables the
corresponding options and explains why; Recheck access refreshes it. The session
setting `LAR_FACTORY_AZURE_READ_ONLY=1` bars Azure writes. Repository, organization
and project names and old consent lists grant no permission. Routine writes
covered by the saved settings need no repeated permission prompt.

The configured source supplies the repository List. Settings stay on this machine.
The factory uses existing project conventions, package scripts, manifests, CI and
nearby tests. Repositories need no factory configuration or guidance files.

## Shape first, build when ready

Add an idea to List or open an issue there. Queue work when you want to shape it,
then choose Start. Shaping reads the issue and code, investigates uncertainties,
and asks you for missing decisions. It produces a Ready brief or a concept map
with parts and relationships. Any issue can be shaped independently of a build.
Ready commits you to no implementation.
Prototypes stay on their prototype branch as references for a later build.
Shaping implements no product changes.

Choose Start build later for a Ready item you want implemented. It opens an
isolated worktree from the repository's resolved default branch or the chosen PR
target, plans and builds the change, runs project checks and reviews,
and opens a PR. Visible or risky work goes to Verify with steps for you to check;
otherwise it goes to Ready to merge. You merge it. Needs you means the work is
waiting for a decision, an answer or verification.

Work records keep ordinary progress on this machine, including queue, board
Status, decisions, slices, threads and review results. Tracker sync never
writes queue, board Status, workflow stage or per-item progress to a tracker.

## Add work and create issues

Add item's Create issue checkbox follows the selected repository's default and
can change it for one submission. GitHub offers labels, assignee and milestone,
plus issue type for organization repositories. Azure offers work item type,
tags, assignee and iteration, using the team's default area. Only title,
repository and kind are required. Kind mappings fill labels and type; the other
fields start empty. Fields without write Access are hidden and omitted.
Optional vocabulary mappings allow none, suggest existing same-name labels and
create typed labels only when saved. Onboarding folds them into an optional
section, and leaving it closed creates no labels.

An unreadable options list still allows title and description; Azure requires a
readable backlog type. A failed create keeps the draft open and adds nothing to
List. An uncertain outcome blocks resubmission while its durable request ID and
hidden marker look for the existing ticket. If Azure strips the marker, check
the board as the error requests. If the ticket exists but its local record could
not be saved, use Find a ticket with the issue named in the error.

A ticketless item's details offer Create issue beside Attach a ticket, with the
same options and a preview of its stored title and text, without text editing.
It keeps the work ID and works regardless of the Add item default. It sends the
description, or the current passing brief as Spec with Original when Spec writing
is ON. Picked retro suggestions use the separate retro default, kind mappings
and their description. Failed retro creates stay local and report the error for
later conversion. `lar-work create` alone stays local. Concept captures follow
structure sync. Each card, row and item details shows GitHub, Azure or a laptop
for local work; conversion updates the source icon.

## Ticket Specs

With Write the refined spec to the issue ON, a passing gate puts the whole
brief in the ticket's main description as Spec and preserves its earlier text
as Original. This includes other people's tickets in onboarded repositories;
concept maps, decisions, slices and Dependency tickets are excluded.
The ticket becomes the source of truth and the record keeps a copy for gates
and builds. Before the first Spec, or with the setting OFF, briefs stay local.

A durable outbox retries failed writes; the item stays Ready and offers retry
in details. The last synced digest or revision distinguishes an unchanged
ticket from a tracker edit, preserving an unsent brief after failure. A
concurrent main-text edit on the tracker wins and gate history keeps the
replaced unsent text. GitHub rereads just before writing but has a small race
because it has no conditional body update; Azure tests the work-item revision.

Trusted tracker title and Spec edits become the local copy without changing
Status, with their provenance in gate history. GitHub edits whose editor lacks
verified write access, or whose editor is unknown, wait in details for Accept or
Reject. Saving a description in details approves that exact Spec and queues its
ticket write, keeping Ready. Later gates and builds reread the ticket; a failed
read keeps the last local copy and shows a warning. An edit during a build leaves
the running build as it started. Removing markers from an active Spec makes its
whole description count as Spec. Importing a marked ticket on another machine
uses Original as context and restores no local brief. See
[Ticket Specs](skills/shared/issue-tracker/work-records.md#ticket-specs) for the protocol.

GitHub keeps Original collapsed. Azure converts the Spec to HTML and uses a
collapsed Original containing a visible `Original (Lar Factory)` heading as a
safe fallback for sanitizers that strip HTML comments or details. Bugs use Repro Steps, leaving separate Description
content intact. Fake-provider fixtures cover preserved and stripped markup; they
do not establish how a live Azure deployment sanitizes these fields.

## Tracker structure sync

The ON-by-default onboarding option saves concepts and multi-repository structure
only. It saves kind, map diagram, parts, Connections between repositories,
Dependencies on other owners, and which issues belong together. It includes only
shaping results necessary to explain that structure. Decision records, slices
and progress stay local. A whole gated brief and its enabled domain drafts use
the separate Ticket Spec setting. Turning sync OFF keeps
structure local too and causes no later publish prompt.

Local structural changes enter an outbox that drains automatically while sync is
ON. `lar-work sync-structure <work ID>` requests structural sync explicitly.
The app and local-settings helper use only `structureSync` for this local option,
stored as `settings.structureSync`.

GitHub saves managed projections, manifests and compressed chunks in immutable
comments. The `linked-work` label makes them discoverable. The factory creates
the label if absent when structure is first used and preserves existing labels.
Structure sync never patches authored GitHub issue bodies; Ticket Specs use the
separate body-write path. Azure saves a managed description
block with revision checks and stores compressed chunks in Markdown comments.
Onboarding checks the access each provider needs before enabling sync.

Conflicting versions stop sync and retain both copies. There is no conflict
resolution UI yet. Read [the structural protocol](skills/shared/issue-tracker/publication.md#storage-and-conflicts)
for save, recovery and detach behavior.

On a fresh installation, add the repository and add the saved concept or
multi-repository work from List. This restores kind, map, parts and relationships,
including Connections and Dependencies. Restored items start in List. Tracker
sync does not restore ordinary briefs, decisions, slices or build progress.

## Domain docs

One local `domainDocs` setting controls domain drafting and file writes. OFF is
`{ "kind": "off" }`; a saved `private` value also reads as OFF. With it OFF,
shaping creates no drafts, Domain docs says "none", and builds write no glossary
or ADR files and offer no later publication. ON is
`{ "kind": "repository", "glossary": "GLOSSARY.md", "adrs": "docs/adr" }`.
With it ON, shaping drafts entries in work records, the whole gated brief puts
them in the ticket Spec when enabled, and builds include the relevant glossary
entries and ADRs in their build PR, creating files only when needed. Shaping
itself leaves repository files unchanged.

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

The board shows T3 shell status immediately. It observes active unfinished local
PRs every 15 seconds with conditional ETag reads, including builds without a
ticket. Usage totals cover board thread families only. Manage skill maintenance
in Settings > Skills.

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
