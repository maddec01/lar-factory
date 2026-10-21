# Board

A local board for the Mux project. It reads the project through your `gh` login
every 45 seconds (`config.json`) and serves it on http://127.0.0.1:4317. Open it
in a browser or in T3's browser preview.

```sh
cd board && npm install && npm start   # npm run dev restarts on changes
```

- **Board** shows what needs you first (Needs you, Verify, Ready to merge), then
  what's in flight, concepts with their sub-issues, Queued items with a copyable
  `/mux-work` command, List counts per platform, and the last 7 days of Done.
  Every card has a step bar showing where it is in the flow.
- **Flow** is the workflow diagram with each issue placed on the step it's at.
  Pick an issue type to follow its path.
- **Add item** creates an issue in a configured repository and adds it to List.
  Choose its kind and optional applicability labels. Empty applicability groups
  mean all apps, all operating systems, or both server areas. The form keeps
  your draft while the board refreshes. If project assignment fails after the
  issue is created, its link and **Retry this submission** finish the same issue.

Creation uses the same local `gh` login as reads and needs permission to create
issues and edit the Mux project. If a response is lost, retry the current
submission. An uncertain GitHub creation or a board restart asks you to check
the repository issues before starting another item.

If `gh` can't reach GitHub, the board keeps the last data it read and shows a
stale warning. `npm run sample` serves `test/sample.json` instead of GitHub;
adding items is disabled in sample mode.

To start it at login, run `board/scripts/install-launch-agent.sh` from the main
checkout. It's safe to rerun and logs to `~/Library/Logs/mux-board.log`;
`board/scripts/uninstall-launch-agent.sh` removes it.

`npm test` renders the sample and compares it with the saved copies in
`test/expected/`; `npm run test:update` rewrites them after a deliberate change.
