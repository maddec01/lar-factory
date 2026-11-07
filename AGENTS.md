# Lar Factory

Skills, build agents and a local board for working on any repository. See the README for
the flow and `docs/plan.md` for how it was set up.

- `skills/` holds copies of upstream skills, unchanged, plus lar's own skills
  (`lar-shape`, `lar-build`); checkout-only `skill-sync` lives in `.agents/skills/`. Never edit a copy by hand: upstream changes come in
  through `skill-sync`, which updates `UPSTREAM.md`. Factory rules go in the skill
  that loads the Copy. Existing project instructions supply project conventions. To set aside part of a Copy, write an Override:
  a rule beside the step that loads the Copy, citing its file and section heading, listed
  in the Copy's "Overridden in" column of `UPSTREAM.md`.
- The board is a root pnpm workspace laid out like T3 Code's monorepo:
  `apps/server`, `apps/web`, `apps/desktop` (the Electron board app),
  `packages/shared`, `packages/ui` (the board's own UI on the design system) and `packages/work-records`
  (the work-record database and its `lar-work` command, which browser code never
  imports). Apps import only packages, never each other. Code sits in feature folders (`src/github/`,
  `src/items/`) with no wrapper folders such as `services/`. File names are
  kebab-case, except Copies and code Ports, which keep their source's names. Skill-text Ports use kebab-case names for their lar step. Unit
  tests sit next to the file they test.
- `apps/web/src` is laid out like Lar's other web apps (lar-server's and lar-platform's `web/src`), not as above:
  `app/` is the composition root (providers, the shell with the title bar and loading screen), `features/<feature>/`
  holds one user-facing area with an `index.ts` public API, `services/<domain>/` the board's data and server calls
  (`<domain>.service.ts`, `<domain>.hooks.ts`, never UI), `shared/` cross-cutting foundations and `test/` the test
  support. Components are PascalCase (`ItemDialog.tsx`), hooks `useX.ts`; imports across those folders use the `@/`
  alias, with no file extensions. `lar/boundaries` and `max-lines` (in `@lar-works/config`) enforce it.
- Components, tokens and styles come from `@lar-works/design-system` (lar-web); import icons from
  `@lar-works/design-system/icons`, never from `lucide-react` (only `DynamicIcon`, which it doesn't re-export, comes
  from `lucide-react/dynamic`). `packages/ui` holds the board's own UI on top of it
  and two Copies from lar-web, listed in its `UPSTREAM.md`. Never edit one: take a fresh copy from upstream and
  update its row.
- Repository settings live only in the local app data folder. The factory never
  reads, writes, detects or offers repository configuration or guidance files.
  Nothing secret goes in this public repo. Provider access uses local logins.
- Every commit and PR title uses conventional commits (`type(scope): description`;
  scopes: `board`, `lar-shape`, `lar-build`, `skill-sync`, `skills`, `ci`). A required check and the
  `commit-msg` hook enforce it. Update branches by rebase; fold review fixes in with
  `git rebase -i --autosquash`. Agents push branches and open PRs, never `main`;
  The user merges every PR.
- Board changes: run `pnpm test` in each of `apps/server`, `apps/web`,
  `apps/desktop`, `packages/shared`, `packages/ui` and `packages/work-records` that changed (`pnpm test` at
  the root runs them all), then `pnpm run typecheck`, `pnpm run knip` and `pnpm run check` at the root.
  `pnpm run check` checks formatting, lint and types with Lar's shared rules (`@lar-works/config`, set up in the
  root `vite.config.ts`); `pnpm run fix` formats and applies the lint fixes. Copies and skill text stay unformatted.
  `pnpm run dev` at the root opens the board app's window.
- Sample board: `BOARD_PORT=<port> pnpm run sample` in `apps/server`, on a port where
  `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing (the board app's board
  usually holds 4317). Stop it with that command `| xargs kill`; never `pkill` by pattern.
  When a change touches T3-backed screens, use `pnpm run sample:t3` the same way: sample
  items and PRs with real T3 projects, icons and availability, and every write refused.
  Keep screenshots of its project step out of PRs, because that step shows real project
  names and folders and this repo is public.
- Release secrets wizard changes: run `bash scripts/release-secrets.test.sh` and
  `shellcheck scripts/release-secrets.sh`. Never run the wizard without `--dry-run`.
- Shared script changes: run `bash skills/shared/scripts/slice.test.sh`,
  `bash skills/shared/scripts/remove-slice-worktree.test.sh`,
  `bash skills/shared/scripts/status.test.sh` and
  `bash skills/shared/scripts/repo-config.test.sh`.
- skill-sync script changes: run each `.agents/skills/skill-sync/scripts/*.test.sh` with `bash`.

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
