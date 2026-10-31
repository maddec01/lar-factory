# Lar Factory

Skills, build agents and a local board for working on lar. See the README for
the flow and `docs/plan.md` for how it was set up.

- `skills/` holds copies of upstream skills, unchanged, plus lar's own skills
  (`lar-shape`, `lar-build`); checkout-only `skill-sync` lives in `.agents/skills/`. Never edit a copy by hand: upstream changes come in
  through `skill-sync`, which updates `UPSTREAM.md`. lar rules go in the skill that loads the Copy or
  in each lar repo's `AGENTS.md`. To set aside part of a Copy, write an Override:
  a rule beside the step that loads the Copy, citing its file and section heading, listed
  in the Copy's "Overridden in" column of `UPSTREAM.md`.
- The board is a root pnpm workspace laid out like T3 Code's monorepo:
  `apps/server`, `apps/web`, `apps/desktop` (the Electron board app),
  `packages/shared`, `packages/ui` (the design system) and `packages/work-records`
  (the work-record database and its `lar-work` command, which browser code never
  imports). Apps import only packages, never each other. Code sits in feature folders (`src/github/`,
  `src/items/`) with no wrapper folders such as `services/`. File names are
  kebab-case, except Copies and code Ports, which keep their source's names. Skill-text Ports use kebab-case names for their lar step. Unit
  tests sit next to the file they test.
- `packages/ui` holds Copies of lar-server's design system, listed in its `UPSTREAM.md`.
  Never edit one: take a fresh copy from upstream and update its row.
- Nothing secret goes in this public repo or in any repository's Repository config
  (`.lar-factory.json`); the board reads GitHub through the local `gh` login.
- Every commit and PR title uses conventional commits (`type(scope): description`;
  scopes: `board`, `lar-shape`, `lar-build`, `skill-sync`, `skills`, `ci`). A required check and the
  `commit-msg` hook enforce it. Update branches by rebase; fold review fixes in with
  `git rebase -i --autosquash`. Agents push branches and open PRs, never `main`;
  The user merges every PR.
- Board changes: run `pnpm test` in each of `apps/server`, `apps/web`,
  `apps/desktop`, `packages/shared`, `packages/ui` and `packages/work-records` that changed (`pnpm test` at
  the root runs them all), then `pnpm run typecheck` and `pnpm run knip` at the root.
  `pnpm run dev` at the root opens the board app's window.
- Sample board: `BOARD_PORT=<port> pnpm run sample` in `apps/server`, on a port where
  `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing (the board app's board
  usually holds 4317). Stop it with that command `| xargs kill`; never `pkill` by pattern.
- Release secrets wizard changes: run `bash scripts/release-secrets.test.sh` and
  `shellcheck scripts/release-secrets.sh`. Never run the wizard without `--dry-run`.
- Shared script changes: run `bash skills/shared/scripts/slice.test.sh`,
  `bash skills/shared/scripts/status.test.sh` and
  `bash skills/shared/scripts/repo-config.test.sh`.
- skill-sync script changes: run each `.agents/skills/skill-sync/scripts/*.test.sh` with `bash`.
- Factory work and its Status live in work records on this machine, never on
  issues or PRs. Move Status with `status.sh <work ID>`; a build's standalone PR
  has no Status of its own.

## Domain docs

Single-context: one root `GLOSSARY.md` and `docs/adr/`. Read both before
shaping or building; a build PR writes the brief's **Domain docs** to them.

## Worktree builds

Every worktree gets its own workspace install at the root from pnpm's shared
store, so a new worktree installs in seconds. Setup also runs the locked Electron
package's `install.js`, which fetches the Electron binary into `apps/desktop`,
reusing the download cache in `~/Library/Caches/electron`.

- One-time machine setup: `brew install pnpm`, then point git at main's hooks with
  an absolute path, so worktrees of older branches run them too. From any checkout:
  `git config core.hooksPath "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.githooks"`.
- After that, `git worktree add` (the `post-checkout` hook) and T3 (`t3.json`)
  both run `scripts/setup-worktree.sh` in the new worktree.
- If `node_modules` is missing, run `bash scripts/setup-worktree.sh` from the
  worktree (on a branch from before this setup, use main's copy of the script). It
  also installs branches from before the workspace, with `board/` and `app/`. It
  leaves a `node_modules` made by npm alone; delete it to switch.
- Setup changes: run `bash scripts/setup-worktree.test.sh`.

## Agent skills

Use `lar-shape` for shaping and decisions, and `lar-build` for builds.

### Issue tracker
GitHub issues in this repository, read by Lar Factory and picked into work records. See `docs/agents/issue-tracker.md`.

### Triage labels
No factory labels; an item's kind and Status live in its work record. See `docs/agents/triage-labels.md`.

### Domain docs
A glossary and ADRs, single-context or multi-context. See `docs/agents/domain.md`.
