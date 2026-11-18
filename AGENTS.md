# Lar Factory

Terms are in `GLOSSARY.md`, decisions in `docs/adr/`.

- `skills/**` and `.agents/skills/**` are the product: agent instructions shipped to other repositories.
  Never edit a Copy (listed in `UPSTREAM.md`) by hand; upstream changes come through `skill-sync`. To set
  aside part of a Copy, write an Override beside the step that loads it, citing its file and heading, and
  list it in the Copy's "Overridden in" column.
- Apps import packages, never each other. Browser code never imports `packages/work-records`.
- Design-system tokens, primitives and generic components change in the design-system repository, not here.
- The factory never reads, writes or offers repository configuration or guidance files; settings live in
  the local app data folder. This repo is public: nothing secret, and no screenshots of real project names
  or folders (`pnpm run sample:t3` shows them).
- Conventional commits (scopes: `board`, `lar-shape`, `lar-build`, `skill-sync`, `skills`, `ci`). Update
  branches by rebase and fold review fixes in with autosquash. Never push `main`; the user merges every PR.

## Checks

- Board: `pnpm test`, `pnpm run typecheck`, `pnpm run knip` and `pnpm run check`.
- Sample board: `BOARD_PORT=<port> pnpm run sample` (or `sample:t3`) in `apps/server` on a port where
  `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing (the app usually holds 4317). Stop it with that command
  `| xargs kill`, never `pkill`.
- Release secrets wizard: `bash scripts/release-secrets.test.sh` and `shellcheck scripts/release-secrets.sh`.
  Never run the wizard without `--dry-run`.
- Scripts: run the `*.test.sh` beside any changed script in `scripts/`, `skills/shared/scripts/` or
  `.agents/skills/skill-sync/scripts/` with `bash`.

## Worktrees

One-time setup: `brew install pnpm`, then point git at main's hooks so worktrees of older branches run them:
`git config core.hooksPath "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.githooks"`.
New worktrees then run `scripts/setup-worktree.sh` (via `post-checkout` or `t3.json`); if `node_modules`
is missing, run it by hand (main's copy on older branches).
