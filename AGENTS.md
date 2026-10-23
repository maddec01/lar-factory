# Mux factory

Skills, build agents and a local board for working on Mux. See the README for
the flow and `docs/plan.md` for how it was set up.

- `skills/` holds copies of upstream skills, unchanged, plus Mux's own skills
  (`mux-work`, `skill-sync`). Never edit a copy by hand: upstream changes come in
  through `skill-sync`, which updates `UPSTREAM.md`. Mux rules go in `mux-work` or
  in each Mux repo's `AGENTS.md`.
- `board/` is the local board app. Nothing secret goes in this public repo; the
  board reads GitHub through the local `gh` login, and `config.json` holds only repos,
  their checkout paths under `~` and their roles.
- Every commit and PR title uses conventional commits (`type(scope): description`;
  scopes: `board`, `mux-work`, `skill-sync`, `skills`, `ci`). A required check and the
  `commit-msg` hook enforce it. Update branches by rebase; fold review fixes in with
  `git rebase -i --autosquash`. Agents push branches and open PRs, never `main`;
  Pedro merges every PR.
- Board changes: run `pnpm test` and `pnpm run typecheck` in `board/`. A deliberate
  layout change updates the saved copies with `pnpm run test:update`; a rebase
  conflict in them resolves the same way, then `git add`. Run it on a
  spare port (`BOARD_PORT=4318 pnpm run sample`); 4317 is the live board, so
  stop only the process you started.
- Install script changes: run `bash scripts/install.test.sh`. Run the script
  itself only against a throwaway home, never the real `~/.agents`:
  `env -u CLAUDE_CONFIG_DIR GH_TOKEN=$(gh auth token) HOME=$(mktemp -d) bash scripts/install.sh`.
  The token keeps gh logged in under the new home; unsetting `CLAUDE_CONFIG_DIR`
  stops the skills CLI writing to the real Claude config.
- A PR that no issue tracks goes on the Mux board too: `bash ~/.agents/skills/mux-work/scripts/status.sh <pr-url> "Ready to merge"`.

## Domain docs

Single-context: one root `GLOSSARY.md` and `docs/adr/`. Read both before
shaping or building; a build PR writes the brief's **Domain docs** to them.

## Worktree builds

Every worktree gets its own `board/node_modules` from pnpm's shared store, so a
new worktree installs in seconds and uses almost no disk.

- One-time machine setup: `brew install pnpm`, then point git at main's hooks with
  an absolute path, so worktrees of older branches run them too. From any checkout:
  `git config core.hooksPath "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.githooks"`.
- After that, `git worktree add` (the `post-checkout` hook) and T3 (`t3.json`)
  both run `scripts/setup-worktree.sh` in the new worktree.
- If `board/node_modules` is missing, run `bash scripts/setup-worktree.sh` from the
  worktree (on a branch from before this setup, use main's copy of the script). It leaves a `node_modules` made by npm alone; delete it to switch.
- Setup changes: run `bash scripts/setup-worktree.test.sh`.
