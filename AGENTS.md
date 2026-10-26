# lar Factory

Skills, build agents and a local board for working on lar. See the README for
the flow and `docs/plan.md` for how it was set up.

- `skills/` holds copies of upstream skills, unchanged, plus lar's own skills
  (`lar-work`, `skill-sync`). Never edit a copy by hand: upstream changes come in
  through `skill-sync`, which updates `UPSTREAM.md`. lar rules go in `lar-work` or
  in each lar repo's `AGENTS.md`.
- The board is a root pnpm workspace laid out like T3 Code's monorepo:
  `apps/server`, `apps/web`, `apps/desktop` (the Electron board app),
  `packages/shared` and `packages/ui` (the design system). Apps import only
  packages, never each other. Code sits in feature folders (`src/github/`,
  `src/items/`) with no wrapper folders such as `services/`. File names are
  kebab-case, except Copies and Ports from T3 Code, which keep T3's names. Unit
  tests sit next to the file they test.
- `packages/ui` holds Copies of T3's base components and coss's toast, listed in its `UPSTREAM.md`.
  Never edit one: take a fresh copy from upstream and update its row.
- Nothing secret goes in this public repo; the board reads GitHub through the local
  `gh` login, and `config.json` holds only repos and their roles.
- Every commit and PR title uses conventional commits (`type(scope): description`;
  scopes: `board`, `lar-work`, `skill-sync`, `skills`, `ci`). A required check and the
  `commit-msg` hook enforce it. Update branches by rebase; fold review fixes in with
  `git rebase -i --autosquash`. Agents push branches and open PRs, never `main`;
  Pedro merges every PR.
- Board changes: run `pnpm test` in each of `apps/server`, `apps/web`,
  `apps/desktop`, `packages/shared` and `packages/ui` that changed (`pnpm test` at
  the root runs them all), then `pnpm run typecheck` and `pnpm run knip` at the root.
  `pnpm run dev` at the root opens the board app's window.
- Sample board: `BOARD_PORT=<port> pnpm run sample` in `apps/server`, on a port where
  `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing (the board app's board
  usually holds 4317). Stop it with that command `| xargs kill`; never `pkill` by pattern.
- Release secrets wizard changes: run `bash scripts/release-secrets.test.sh` and
  `shellcheck scripts/release-secrets.sh`. Never run the wizard without `--dry-run`.
- lar-work script changes: run `bash skills/lar-work/scripts/slice.test.sh` and
  `bash skills/lar-work/scripts/status.test.sh`.
- skill-sync script changes: run `bash skills/skill-sync/scripts/preview-copy.test.sh`
  and `bash skills/skill-sync/scripts/override-changes.test.sh`.
- A PR that no issue tracks goes on the lar board too: `bash ~/.agents/skills/lar-work/scripts/status.sh <pr-url> "Ready to merge"`.

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
