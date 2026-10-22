# Board

A local board for the Mux project. It reads the project through your `gh` login
every 45 seconds (`config.json`) and serves it on http://127.0.0.1:4317. Open it
in a browser or in T3's browser preview.

```sh
cd board && pnpm install && pnpm start   # pnpm run dev restarts on changes
```

- **Board** shows what needs you first (Needs you, Verify, Ready to merge), then
  what's in flight, concepts with their sub-issues, Queued items, List counts per
  platform, and the last 7 days of Done. Every card has a step bar showing where
  it is in the flow.
- **Queue** on a List row sets the item's Status to Queued. The board shows it
  in Queued at once and keeps it there until GitHub reports the change.
- **Start** on a Queued issue opens a T3 Code thread in the Mux project
  (`board.t3Project` in `config.json`) whose first message is the issue's
  work message: `#n title`, then `$mux-work owner/repo#n`. T3 titles the
  thread from line 1 and runs mux-work, which shapes or builds the issue and
  sets its Status. A toast shows the thread's id, and its title when T3 chose
  one other than line 1; every board page marks the card Started. While the
  board runs, a double press, a retry or another tab starts no second thread.
  A queued draft needs an issue first; issues keep the work message copyable
  as a fallback.
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
to create issues and edit the Mux project. Start runs the local `t3` CLI (or
`T3_PATH`) and needs T3 Code running. If a response is lost, retry the current
submission. An uncertain GitHub creation or a board restart asks you to check
the repository issues before starting another item.

If `gh` can't reach GitHub, the board keeps the last data it read and shows a
stale warning. `pnpm run sample` serves `test/sample.json` instead of GitHub;
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
button on the launch-agent board, and with a copyable command on dev, sample and
other-port runs, which can't update themselves. Pulling the checkout does not clear the notice: restart the board to
run that revision. A running process keeps its own browser modules and styling
so a new browser load still works after checkout changes. Failed revision
checks show their own warning, separate from stale GitHub project data.

`pnpm test` renders the sample and compares it with the saved copies in
`test/expected/`; `pnpm run test:update` rewrites them after a deliberate change.
