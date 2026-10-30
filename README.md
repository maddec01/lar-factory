<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/lar-factory-on-dark.png">
    <img alt="Lar Factory" src=".github/assets/lar-factory-on-light.png" height="56">
  </picture>
</p>

# Lar Factory

A small software factory for [lar](https://github.com/maddec01): the skills,
build agents and local board that take an idea from a list to a merged PR.
A person decides and merges; agents do the rest.

The [glossary](GLOSSARY.md) defines the factory's terms. Existing decisions are
recorded in [ADRs](docs/adr/): [local GitHub access](docs/adr/0001-use-the-local-gh-login.md),
[The user merges every PR](docs/adr/0002-the-user-merges-every-pr.md),
[Start in the issue's repository project](docs/adr/0009-start-in-the-issues-repository-project.md), and
[item stats from T3 Code's database](docs/adr/0005-read-item-stats-from-t3s-database.md).

It's built for lar, but the parts are plain [Agent Skills](https://agentskills.io)
and a small board app, so you can borrow them. Issues and ideas are welcome.

## How work moves

Work lives in GitHub Issues, one repo for each part of lar (`lar-server`, `lar-apple`),
with status labels on each issue placing it on the board:

```
List → Queued → Shaping ⇄ Needs you → Ready → In progress → Review → Verify / Ready to merge → Done
```

1. **List.** Capture bugs, features and ideas as issues.
2. **Queued.** Pick one by moving it to Queued, then run `/lar-shape <owner/repo#n>`
   in a new thread in the issue's repository project (the board's Start does
   this). Nothing starts without this.
3. **Shaping.** `lar-shape` reads the issue and the code through subagents, and
   proposes a route:
   - **clear**: a bug a subagent can reproduce and diagnose, or a small change;
   - **needs decisions**: it grills you with docs: questions that check your
     terms against the project's glossary and ADRs, and drafts any new terms
     and decisions into the brief for the builder to write. For anything
     visual, it builds two or three prototypes for you to pick from;
   - **foggy**: the issue becomes a **concept**. Its body is a map (destination,
     decisions so far, fog, out of scope, domain docs drafts, a diagram), and
     each decision is its own sub-issue, worked in its own thread. Build
     sub-issues appear as decisions close.
4. **Ready.** It writes a brief into the issue (what, how to tell it's done,
   confirmed assumptions, domain docs drafts). A fresh-context subagent tries
   to find holes in it.
5. **In progress.** A new thread builds it in its own git worktree, test-first,
   from the brief alone.
6. **Review.** Four reviewers run in parallel, each with fresh context: code,
   security, UX and UI (browser preview or simulator). A fixed finding's
   reviewer checks the fix in a next round, on the fix diff only, unless the
   builder skips it with a reason; at most three rounds.
7. **Verify or Ready to merge.** An approver opens the PR. Anything visible, risky
   (auth, migrations, deployment) or not fully checked goes to Verify with test
   steps; the rest goes to Ready to merge. The item stays in Review until the
   PR's required checks pass; a CI fixer subagent handles failures, and after
   two tries or a runner problem the item goes to Needs you.
8. **Retro and merge.** After the final review status is set and PR monitoring
   stops, the build thread ends with suggested improvements for you to pick.
   Picks become follow-up issues in the owning repos (or reuse matching open
   issues); new issues enter List. Shared/global work goes to Factory, and one
   suggestion spanning repos becomes one Factory concept for later shaping.
   Capture leaves the source status unchanged and implements none of the picks.
   Its source-issue record tracks links and unfinished steps; rerun
   `/lar-shape <source-owner/repo#n>` to resume capture only, even with a passing
   brief. See [Retro capture](skills/shared/retro-capture.md) for routing,
   recovery and privacy rules. You merge the original PR to reach **Done**.

**Needs you** means it's waiting on you: a question, a prototype choice or a
review.

Before using the workflow in a destination repository, follow
[issue-tracking setup](skills/shared/issue-tracker/label-setup.md) to create
missing workflow labels while preserving existing ones. [Native relationships](skills/shared/issue-tracker/native-relationships.md) covers
parent/sub-issue and blocked-by commands. Status stays on each issue as a `status-<name>` label.

Every thread starts small: steps hand over through the issue and the PR, never
through a long conversation, and subagents return summaries instead of files.

## Skills

| Skill | What it does | Source |
| ----- | ------------ | ------ |
| `lar-shape` | Size up, shape, brief and gate an item | lar, with upstream Copies |
| `lar-build` | Build an item through slices and review | lar, with upstream Copies |
| `.agents/skills/skill-sync` | Sync upstream Copies from this checkout | lar |

Each installed skill carries the upstream content it needs. `skills/shared/`
holds their common source; assembly copies it into both release skills.
`skills/lar-build/coding-style.md` holds developer-profile.

`UPSTREAM.md` lists the upstream path and commit of every copy.

### Install

Install the board app from
[GitHub Releases](https://github.com/maddec01/lar-factory/releases): download the
newest Release's dmg and drag Lar Factory into Applications. The app installs
`lar-shape` and `lar-build` into `~/.agents/skills`, and links them into the
Claude profiles ticked in Settings (`~/.claude` and each `~/.claude-*`). Each
skill carries its own upstream content and checklists. On every launch the app
restores installed content that differs from the Release.

If you run `npx skills add` yourself, always pass `-a`: `-y` without it installs into
every agent the CLI knows.

### Update

The copies change only when a `skill-sync` PR merges here. Run `/skill-sync` to
see what changed upstream and pick what to take. After merging, start a Release (see
[Releasing](#releasing)) and install it; its first launch updates the skills, adds
newly listed ones, and replaces the checklists.

### Avoiding conflicts

The app manages only `lar-shape` and `lar-build`. User-installed skills keep
their own sources. Copies inside lar's skills change through the checkout's
`/skill-sync`; lar rules live beside the step that loads each Copy. Workflow Ports are lar step files adapted from upstream, with source credits in their headers and reviewed commits in `UPSTREAM.md`.

## Board

The board is a local app that shows the lar project: what needs you, what's in
flight, concepts and their progress, and where every item sits in the flow. It
reads GitHub through your local `gh` login and refreshes itself. The repo is one
pnpm workspace laid out like T3 Code's monorepo: `apps/server` is the board server,
`apps/web` its page, `apps/desktop` the board app and `packages/shared` the code
they share. See [`apps/server/README.md`](apps/server/README.md).

`apps/desktop` is the board app: a Mac window that runs the board, copied from
[T3 Code](https://github.com/pingdotgg/t3code)'s desktop app. It starts
`apps/server/src/server.ts` as a child under Electron's own Node and shows its page.
Quitting the app stops the server. To open it from a checkout, install the
workspace at the repo root and start the window:

```bash
pnpm install && pnpm run dev
```

The first run downloads Electron's binary.

To build a Mac app that runs without the checkout:

```bash
cd apps/desktop && pnpm run build --unsigned
```

It writes an unsigned Apple Silicon app to `apps/desktop/release/mac-arm64/Lar Factory.app`,
with the board server bundled into one file and its built page inside. If macOS refuses to open it,
right-click it in Finder and choose Open. Beside it go a dmg, a zip and the update
feed, `latest-mac.yml`.

`--build-version <version>` builds another version; a Nightly version such as
`0.1.0-nightly.20261023.57` writes `nightly-mac.yml` instead. Without `--unsigned`
the build signs and notarizes, and fails unless `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_API_KEY` (the `.p8` file's path), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and
`APPLE_TEAM_ID` are set. The Release workflow builds that way.

The app's build assembles `lar-shape` and `lar-build` into `apps/desktop/dist-electron/bundle`,
which packaging puts in the app's `Resources/bundle`.
A packaged app installs them into `~/.agents` and the ticked Claude profiles on every
launch, after its window opens, and writes only the skills, links and checklists that
differ from the bundle. It shows a dialog for an error, and for a conflict on the
first launch of each version. A run from a checkout installs only with `--install-skills`,
and `LAR_FACTORY_INSTALL_ROOT` puts the install in another folder instead of your
home. From the repo root:

```bash
LAR_FACTORY_INSTALL_ROOT="$(mktemp -d)" pnpm run dev --install-skills
```

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

```
skills/            lar-shape, lar-build (with agents/), shared source
.agents/skills/    checkout-only skill-sync
apps/server/       the board server: reads GitHub, serves the page and the API
apps/web/          the board page (React, built with Vite+)
apps/desktop/      the board app: the board in a Mac window (Electron)
packages/shared/   types and logic the apps share; apps import it, never each other
scripts/setup-worktree.sh installs the workspace in a new worktree (.githooks, t3.json)
scripts/release-secrets.sh stores the Release signing secrets on GitHub
UPSTREAM.md        source and commit of every copy
docs/plan.md       how this was set up
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
