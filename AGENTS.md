# Mux factory

Skills, build agents and a local board for working on Mux. See the README for
the flow and `docs/plan.md` for how it was set up.

- `skills/` holds copies of upstream skills, unchanged, plus Mux's own skills
  (`mux-work`, `skill-sync`). Never edit a copy by hand: upstream changes come in
  through `skill-sync`, which updates `UPSTREAM.md`. Mux rules go in `mux-work` or
  in each Mux repo's `AGENTS.md`.
- `board/` is the local board app. Nothing secret goes in this public repo; the
  board reads GitHub through the local `gh` login, and `config.json` holds only repos
  and their roles.
- Every commit and PR title uses conventional commits (`type(scope): description`;
  scopes: `board`, `mux-work`, `skill-sync`, `skills`, `ci`). A required check and the
  `commit-msg` hook enforce it. Update branches by rebase; fold review fixes in with
  `git rebase -i --autosquash`. Agents push branches and open PRs, never `main`;
  Pedro merges every PR.
- Board changes: run `pnpm test` and `pnpm run typecheck` in `board/`.
- Board app changes (`app/`, the Electron window): run `pnpm test` and
  `pnpm run typecheck` in `app/`; `pnpm run dev` there opens the window.
- Sample board: `BOARD_PORT=<port> pnpm run sample` in `board/`, on a port where
  `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing (4317 is the launch-agent
  board). Stop it with that command `| xargs kill`; never `pkill` by pattern.
- Install script changes: run `bash scripts/install.test.sh`. Run the script
  itself only against a throwaway home, never the real `~/.agents`:
  `env -u CLAUDE_CONFIG_DIR GH_TOKEN=$(gh auth token) HOME=$(mktemp -d) bash scripts/install.sh`.
  The token keeps gh logged in under the new home; unsetting `CLAUDE_CONFIG_DIR`
  stops the skills CLI writing to the real Claude config.
- Release secrets wizard changes: run `bash scripts/release-secrets.test.sh` and
  `shellcheck scripts/release-secrets.sh`. Never run the wizard without `--dry-run`.
- mux-work script changes: run `bash skills/mux-work/scripts/slice.test.sh` and
  `bash skills/mux-work/scripts/status.test.sh`.
- A PR that no issue tracks goes on the Mux board too: `bash ~/.agents/skills/mux-work/scripts/status.sh <pr-url> "Ready to merge"`.

## Domain docs

Single-context: one root `GLOSSARY.md` and `docs/adr/`. Read both before
shaping or building; a build PR writes the brief's **Domain docs** to them.

## Worktree builds

Every worktree gets its own `board/node_modules` and `app/node_modules` from
pnpm's shared store, so a new worktree installs in seconds. Setup also runs the
locked Electron package's `install.js`, which fetches the Electron binary into
`app/`, reusing the download cache in `~/Library/Caches/electron`.

- One-time machine setup: `brew install pnpm`, then point git at main's hooks with
  an absolute path, so worktrees of older branches run them too. From any checkout:
  `git config core.hooksPath "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.githooks"`.
- After that, `git worktree add` (the `post-checkout` hook) and T3 (`t3.json`)
  both run `scripts/setup-worktree.sh` in the new worktree.
- If `board/node_modules` or `app/node_modules` is missing, run `bash scripts/setup-worktree.sh` from the
  worktree (on a branch from before this setup, use main's copy of the script). It leaves a `node_modules` made by npm alone; delete it to switch.
- Setup changes: run `bash scripts/setup-worktree.test.sh`.
