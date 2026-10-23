# Board

A local board for the Mux project. It reads the project through your `gh` login
every 45 seconds (`config.json`) and serves it on the first free port from
4317 to 4416, which it logs; `BOARD_PORT` pins the port. The launch-agent board
runs on 4317. `BOARD_CONFIG_FILE`, an absolute path, makes it read that file in
place of the checkout's `config.json`; the board app sets it to its own copy.
`BOARD_APP_SECRET`, which the board app sets on each launch, makes every write
except `/api/read` answer 403 unless the request carries it in `X-Board-Secret`. Open it in a browser or in T3's browser preview.

```sh
cd board && pnpm install && pnpm start   # pnpm run dev restarts on changes
```

`pnpm start`, `dev`, `sample` and `test` first build the page with Vite+
(`pnpm run build`) into `dist/`, which git ignores; the server reads it at startup.
`dev` then rebuilds the page when a file changes and restarts the server on each
new build or `src/` change.

- **Board** shows what needs you first (Needs you, Verify, Ready to merge), then
  what's in flight, concepts with their sub-issues, Queued items, List counts per
  platform, and the last 7 days of Done. Every card has a step bar showing where
  it is in the flow.
- **Queue** on a List row sets the item's Status to Queued. The board shows it
  in Queued at once and keeps it there until GitHub reports the change.
- **Start** on a Queued issue opens a T3 Code thread in the issue's repository
  project, the T3 project whose folder is a main checkout with the repository
  as its git `origin`, whose first message is the issue's work message: `#n title`, then `$mux-work owner/repo#n`. T3 titles the
  thread from line 1 and runs mux-work, which shapes or builds the issue and
  sets its Status. Start ▾ opens a menu of model choices: "T3 default" (the
  project's default model), then each enabled T3 provider instance with its
  models; picking one starts the thread on it, and Escape or a click outside
  closes the menu without starting anything. A toast shows the thread's id, and its title when T3 chose
  one other than line 1; every board page marks the card Started. While the
  board runs, a double press, a retry or another tab starts no second thread.
  A queued draft needs an issue first. Before starting, Start checks that the
  repository is in `config.json`, then reads T3 Code's live projects from its
  database (read-only) and keeps those whose folder exists, has a `.git`
  directory (so a worktree doesn't count) and has the repository as its git
  `origin`. The folder can have any name and live anywhere. With no such
  project, Start refuses with a hint to add the checkout in T3 Code; with two
  or more, it refuses and names their folders. The board never adds or changes
  T3 projects, and it refuses when it can't read T3's database.
- **Back to List**, in the footer row of a Queued issue or draft card, is the
  reverse of Queue: it sets the item's Status back to List, and the board moves
  the card there at once. **Abandon**, on the right of the same row, works as
  it does on List rows: after the same prompt it deletes the issue for good or
  removes the draft. Queued pull requests get no footer row. Once a card's
  Start is running, may have started or has started, the row disappears and
  the board refuses both actions for it; while either is running, it refuses
  Start. The board remembers Started only until it restarts.
- **Flow** is an outline of how items relate: sub-issues sit under their
  parent, and each issue lists the issues it is blocked by and the ones it
  blocks, as GitHub records them. A link to an item on the Board jumps to it;
  issues that aren't on the Board (including Done items older than 7 days) show
  as dashed references with their open or closed state. Nothing is inferred.
- **Notices**: a success (Added, Moved, Abandoned, Started, a finished update)
  is a toast that clears after about 5 s. A failure stays until you close it
  or the next attempt succeeds. Warnings such as stale data or an available
  update stay while their cause lasts. Closing is per page: a reload shows
  again whatever still holds.
- **Add item** creates an issue in a configured repository and adds it to List.
  Choose its kind and optional applicability labels. Empty applicability groups
  mean all apps, all operating systems, or both server areas. The form keeps
  your draft while the board refreshes. If project assignment fails after the
  issue is created, its link and **Retry this submission** finish the same issue.

Creation and Queue use the same local `gh` login as reads and need permission
to create issues and edit the Mux project. Start runs the local `t3` CLI and
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
read and shows a stale warning. `pnpm run sample` serves `test/sample.json` instead of GitHub;
adding, queuing and starting are disabled in sample mode.

To start it at login, run `board/scripts/install-launch-agent.sh` from the main
checkout. It's safe to rerun and logs to `~/Library/Logs/mux-board.log`;
`board/scripts/uninstall-launch-agent.sh` removes it.

The launch-agent board has an **Update** button in its header. It runs the
updater for the checkout the board was started from, apart from the board so it
survives the restart, and the page shows each step as it finishes, reloads onto
the new revision, or names the failed step with the end of its log. Update is
refused while a Start or another update runs, and Start waits for an update.
From a terminal, run from the main factory checkout:

```sh
bash board/scripts/update.sh
```

See the [factory update instructions](../README.md#update) for requirements,
refused histories, partial failures and extra Claude profiles. The updater
refreshes the launch-agent configuration and confirms the new process is
serving the expected revision before installing skills. It is safe to rerun.

The board checks remote `main` every refresh cycle and shows **Board update
available** when it contains commits absent from this process: with the Update
button on the launch-agent board, and with a copyable command on dev and sample
runs, which can't update themselves. Pulling the checkout does not clear the notice: restart the board to
run that revision. A running process keeps the built page it started with,
so a new browser load still works after checkout changes or a rebuild. Failed revision
checks show their own warning, separate from stale GitHub project data.

`pnpm test` runs the server tests with Node's test runner, then the page tests in
`test/page/` with Vitest in a DOM. That DOM, jsdom, needs Node 22.22.2+, 24.15+ or 26+;
the board itself runs on 22.18+.
