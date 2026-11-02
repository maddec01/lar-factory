# Workspace test investigation

Slice 16ba6421 is incomplete. No tests were removed or consolidated.

The root command is `pnpm test`. It runs up to four workspace scripts concurrently and then desktop separately. Server builds web before testing. Web limits itself to two workers; other packages use default worker counts. This review inventoried 99 server, 50 web, 22 desktop, 26 shared, two UI and 14 work-record test files. A complete behavioral review remains outstanding.

## Evidence and conditions

Runs used the existing workspace install on macOS on 2026-11-02. Other workspace processes were active, so these are observations rather than comparable performance measurements. Raw evidence is in `/tmp/lar-780-workspace/`.

The first root run used the shell default Node 22.23.3, below the declared minimum 24.15. It was explicitly terminated by the implementer after it did not finish. Its log is `root-before.log`; `processes.txt` records a process snapshot. This does not establish the cause of the historical kill.

The second root run used Node 24.22.1 through `/opt/homebrew/opt/node@24/bin` and pnpm 12.14.0. Its log is `root-node24.log`. It reported failures in publication-records and tracker-sync. Tracker-sync belongs to another slice. A successful complete root run and six-package timing comparison remain outstanding.

UI baseline reported 0.929 seconds under Node 22. The affected suite after cleanup passed all 34 tests in 3.08 seconds under Node 22 and 6.05 seconds under Node 24. These runs overlapped root testing and cannot establish a speed change. Shared reported 3.04 seconds under Node 22 and 38.23 seconds under Node 24 during concurrent activity.

## Change and checks

The existing compiled-CSS test helper now removes its temporary directory in finally, including assertion and compiler failures. It is not listed as a Copy. No additional helper or test was needed. Restart, server-support and tracker-sync were unchanged.

Affected UI tests, root typecheck, root knip and git diff --check passed. Logs are `ui-after.log`, `ui-node24.log`, `typecheck.log` and `knip.log`. No root success is claimed.
