# Mux factory

Skills, build agents and a local board for working on Mux. See the README for
the flow and `docs/plan.md` for how it was set up.

- `skills/` holds copies of upstream skills, unchanged, plus Mux's own skills
  (`mux-work`, `skill-sync`). Never edit a copy by hand: upstream changes come in
  through `skill-sync`, which updates `UPSTREAM.md`. Mux rules go in `mux-work` or
  in each Mux repo's `AGENTS.md`.
- `board/` is the local board app. Nothing secret goes in this public repo; the
  board reads GitHub through the local `gh` login and `config.json` only names repos.
- Every commit and PR title uses conventional commits (`type(scope): description`;
  scopes: `board`, `mux-work`, `skill-sync`, `skills`, `ci`). A required check
  enforces it. Update branches by rebase; fold review fixes in with
  `git rebase -i --autosquash`. Agents push branches and open PRs, never `main`;
  Pedro merges every PR.
- Board changes: run `npm test` and `npm run typecheck` in `board/`. A deliberate
  layout change updates the saved copies with `npm run test:update`. Run it on a
  spare port (`BOARD_PORT=4318 npm run sample`); 4317 is the live board.
- Install script changes: run `bash scripts/install.test.sh`. Run the script
  itself only against a throwaway home, never the real `~/.agents`:
  `GH_TOKEN=$(gh auth token) HOME=$(mktemp -d) bash scripts/install.sh`. The
  token keeps gh logged in under the new home.
- A PR that no issue tracks goes on the Mux board too: `bash ~/.agents/skills/mux-work/scripts/status.sh <pr-url> "Ready to merge"`.
