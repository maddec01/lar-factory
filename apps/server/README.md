<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../.github/assets/lar-factory-on-dark.png">
    <img alt="Lar Factory" src="../../.github/assets/lar-factory-on-light.png" height="56">
  </picture>
</p>

# Board

A local board for the lar project. It reads the onboarded repositories through your
`gh` login (see [Adding a repository](#adding-a-repository)), each item source at
its own pace ([ADR 0028](../../docs/adr/0028-each-item-source-reads-at-the-pace-of-its-work.md)):
whole every `refreshSeconds` (5 minutes, at least 1), and its changed items
alone. Every 5 seconds each GitHub source asks GitHub whether anything changed,
sending the last answer's ETag; an unchanged answer is a 304, which costs no
quota, so an edit on github.com shows within seconds and reads only the changed
item. An item also reads alone at once when `status.sh` or `slice.sh` names it,
every 15 seconds while its PR's checks run, and, in an Azure
DevOps team, every 15 seconds while it holds active work. A rate-limited `gh` or `az` makes no calls until its limit resets. T3's threads
refresh every 2 seconds and its stats every 30, with no `gh` or `az` call. It
serves the board on the first free port from 4317 to 4416, which it logs;
`BOARD_PORT` pins the port. The board app's board usually gets 4317.
`BOARD_APP_SECRET`, which the board app sets on each launch, makes every write
except `/api/read` answer 403 unless the request carries it in `X-Board-Secret`.
Before it installs an update, the app posts that secret to `/api/drain`: the board
refuses new writes with 503 and answers once the running ones finish. Without
`BOARD_APP_SECRET` the board refuses every drain. Open it in a browser or in T3's browser preview.

```sh
pnpm install                        # once, at the repo root
cd apps/server && pnpm start        # pnpm run dev restarts on changes
```

`pnpm start`, `dev`, `sample` and `test` first build the page in `apps/web` with Vite+
into `apps/web/dist/`, which git ignores; the server reads it at startup.
`dev` then rebuilds the page when a file changes and restarts the server on each
new build or `src/` change.

- **Board** shows what needs you first (Needs you, Verify, Ready to merge), then
  what's in flight, concepts with their sub-issues, Queued items, List counts per
  repository, and the last 7 days of Done. Every card has a step bar showing where
  it is in the flow.
- **Queue** on a List row sets the item's Status to Queued. The board shows it
  in Queued at once and keeps it there until GitHub reports the change.
- **Start** on a Queued issue opens a T3 Code thread in the issue's repository
  project, the T3 project whose folder is a main checkout with the repository
  as its git `origin`, whose first message is the issue's work message: `#n title`, then `$lar-work owner/repo#n`. T3 titles the
  thread from line 1 and runs lar-work, which shapes or builds the issue and
  sets its Status. Start ▾ opens a menu of model choices: "T3 default" (the
  project's default model), then each enabled T3 provider instance with its
  models; picking one starts the thread on it, and Escape or a click outside
  closes the menu without starting anything. A toast shows the thread's id, and its title when T3 chose
  one other than line 1; every board page marks the card Started. While the
  board runs, a double press, a retry or another tab starts no second thread.
  Before starting, Start checks that the
  repository is in `repositories.json`, then reads T3 Code's live projects from its
  database (read-only) and keeps those whose folder exists, has a `.git`
  directory (so a worktree doesn't count) and has the repository as its git
  `origin`. The folder can have any name and live anywhere. With no such
  project, Start refuses with a hint to add the checkout in T3 Code; with two
  or more, it refuses and names their folders. The board never adds or changes
  T3 projects, and it refuses when it can't read T3's database.
- **Back to List**, in the footer row of a Queued issue card, is the
  reverse of Queue: it sets the item's Status back to List, and the board moves
  the card there at once. **Abandon**, on the right of the same row, works as
  it does on List rows: it asks first, then closes a GitHub issue as "not planned"
  or moves an Azure DevOps work item to Removed. Reopen it in its provider to
  bring it back. Once a card's Start is running, may have started or has started, the row disappears and
  the board refuses both actions for it; while either is running, it refuses
  Start. The board remembers Started only until it restarts.
- **Notices**: a success (Added, Moved, Abandoned, Started, a finished update)
  is a toast that clears after about 5 s. A failure stays until you close it
  or the next attempt succeeds. Warnings such as stale data or an available
  update stay while their cause lasts. Closing is per page: a reload shows
  again whatever still holds.
- **Add item** creates an issue in a configured repository and adds it to List.
  Choose its kind and any of the repository's custom labels, the `labels` in its
  `.lar-factory.json`. The form keeps your draft while the board refreshes. If a confirmed issue needs another step, **Retry this submission** finishes the same issue.

Creation and Queue use the same local `gh` login as reads and need permission
to create issues and edit their labels. Start runs the local `t3` CLI and
needs T3 Code running. If a response is lost, retry the current submission. An
uncertain GitHub creation or a board restart asks you to check the repository
issues before starting another item.

At startup the board looks up `t3`, `gh` and `az` the way T3 Code does, so it
finds them when opened with a bare PATH. For each tool it tries the override
(`T3_PATH`, `GH_PATH`, `AZ_PATH`), then your login shell's PATH, then
`/opt/homebrew/bin` and `/usr/local/bin`. An override with a `/` is used as
given, and if it isn't runnable the tool counts as missing. A bare name is
looked up on the PATH. Sample mode looks up no tools.

With no `t3` found, a "T3 Code not found" notice replaces the board. A missing
`gh` gets a notice with `brew install gh`, and a logged-out one a notice with
`gh auth login`. Each notice has a Recheck button that looks the tools up again
without a restart, and the board also looks again every 10 seconds while one
shows. A broken override is named in its notice. A missing `az` shows nothing.

If `gh` can't reach GitHub for another reason, the board keeps the last data it
read and shows a stale warning. `pnpm run sample` serves `packages/shared/test/sample.json` instead of GitHub;
adding, queuing and starting are disabled in sample mode.

## Adding a repository

Open Settings, then Repositories, then Add repository. Pick a repository from
your T3 Code projects. GitHub reads its repository issues; Azure DevOps reads the
team's backlog and current sprint together. Check access and create any missing
workflow labels. Review the cleanup choices and open the onboarding PR. Merge
that PR to finish. The board remembers your progress so you can resume from Settings.

### Manual configuration reference

The board reads two files in the board app's data folder, `~/Library/Application Support/Lar Factory/`:

- `repositories.json` lists the onboarded repositories, each GitHub one as
  `owner/name` and each Azure DevOps one as `organization/project/repository`, as
  its origin URL names them. Without it, the board shows no repository.
- `settings.json` holds the board-wide settings. Today that is `refreshSeconds`,
  how often the board reads item sources with no active work and the Repository
  configs, 300 when the file or the field is missing.

Each onboarded repository keeps its Repository config in `.lar-factory.json` at its
root. The board reads it with `gh` from the repository's default branch every
`refreshSeconds` and on a read request naming no item, never from a checkout, so a change shows once it merges to the default
branch. Its fields:

- `version`: the file's shape, `1`. A missing `version` counts as `1`.
- `role`: what the repository is for, which lar-work reads. Required.
- `itemSource`: `{ "kind": "issues" }` for GitHub repository issues (the default), or
  `{ "kind": "azure-board", "team": "<team>" }` on Azure DevOps. The Azure board
  combines the team's open backlog and current sprint, with each item once. It keeps
  completed sprint work and reads the backlog alone when no sprint is current.
  Unsupported source kinds fail with a message to run onboarding again.
- `show`: `"all"`, the default, or `"opted-in"`.
- `labels`: an array of strings, empty by default.

To add lar-factory, write `repositories.json`:

```json
{ "repositories": [{ "repo": "maddec01/lar-factory" }] }
```

and merge this `.lar-factory.json` to lar-factory's default branch, which reads its
repository issues:

```json
{
  "version": 1,
  "role": "The factory: board, lar-work skill and process docs",
  "itemSource": { "kind": "issues" }
}
```

On its next refresh the board shows lar-factory. If `repositories.json` isn't valid
or has the wrong shape, the board shows the read error with the file's path. If a
repository's `.lar-factory.json` is missing or wrong, the board leaves that
repository off and names it in a notice.
`bash skills/lar-work/scripts/repo-config.sh maddec01/lar-factory` prints the
config the board reads, with defaults filled in.

To use the board every day, install the board app from
[GitHub Releases](https://github.com/maddec01/lar-factory/releases) (see the
[factory install instructions](../README.md#install)). `pnpm start`, `pnpm run dev`
and `pnpm run sample` are for developing the board. A running process keeps the built
page it started with, so a new browser load still works after checkout changes or a
rebuild.

`src/server.ts` starts the board: it reads GitHub, checks the tools and wires the rest.
`src/board/` holds the board data and the changes laid over it, `src/items/` the item
commands and their locks, and `src/http/` the routes.

`pnpm test` runs the server tests with Vitest: unit tests sit next to the
files they test in `src/`, and the tests that start the whole board, with their fixtures,
in `test/`. The page tests sit next to their files in `apps/web/src/`; `pnpm test` in
`apps/web` runs them with Vitest in a DOM. The board and its tests need Node 24.15+ (jsdom's
minimum on the 24 line); the root `.node-version` pins 24.
