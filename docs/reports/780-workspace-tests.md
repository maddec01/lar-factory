# Workspace test investigation

Final aggregate slice 2e84288b-6900-4374-9d61-22a0aac0f1aa validates build b2c9ee5a-5215-4826-8ab5-92814a60d7c1 against main. Source review is complete across all six packages. Earlier overlapping measurements are historical observations only.

## Matched measurements

Measured sequentially on 2026-11-02 in /Users/pedrogomes/.t3/worktrees/lar-factory/t3-322b0170. Baseline is 66737997. Final implementation is b370b5d06a360aa060b830280fd1ed3b85b57ecd on slice/2e84288b-workspace-validation. The clean worktree switched detached to baseline and then back, without resets. Both phases used Node 24.22.1, pnpm 12.14.0 and /opt/homebrew/opt/node@24/bin first on PATH. Each phase ran pnpm install --frozen-lockfile and pnpm --filter @lar-factory/web build before timing. Dependencies remained installed and build output was warm in both phases.

Commands were /usr/bin/time -l pnpm --dir <package> test, in the table order, then /usr/bin/time -l pnpm test. No intentionally concurrent suites ran beside these commands. Package-internal workers and root workspace concurrency retained their defaults. Background machine activity and cache variation were not controlled. This single matched pair does not establish a repeatable speed change.

| Package or command | Before wall seconds | After wall seconds | Exit before/after |
| --- | ---: | ---: | --- |
| server | 91.19 | 102.83 | 0 / 0 |
| web | 59.05 | 67.69 | 0 / 0 |
| desktop | 5.56 | 5.87 | 0 / 0 |
| shared | 3.24 | 3.57 | 0 / 0 |
| ui | 0.55 | 0.61 | 0 / 0 |
| work-records | 34.25 | 33.08 | 0 / 0 |
| root | 170.45 | 174.83 | 0 / 0 |

Both root runs completed. Final totals are 896 server, 947 web, 219 desktop, 376 shared, 34 UI and 253 work-records tests. Baseline desktop had 220 tests. The root pair shows no aggregate speed improvement.

## Runner and failure investigation

Root runs recursive workspace tests with the default four-script concurrency, excludes desktop, then runs desktop separately. It preserves recursive failure status when desktop succeeds and returns desktop failure otherwise. Server assembles skills and builds web. No runner change is justified by these passing runs. No command was killed for elapsed time.

Raw logs, exit statuses, run script, ps snapshots and vm_stat snapshots are in /tmp/780-final. The time logs include user/system CPU, maximum resident set size, page faults, swaps and context switches. These are local evidence, not portable artifacts. time measures the pnpm parent and reports child accounting where available; its memory figure is not aggregate peak workspace memory. Process snapshots are instantaneous. They do not establish historical resource exhaustion. The earlier Node 22 run was explicitly terminated; the historical kill remains unexplained. Publication's historical five-second failure remains unreproduced, with no demonstrated reason to alter its timeout.

## Coverage and removal inventory

The server source reviews are in 780-server-group-1.md through 780-server-group-5.md, including the recovered six-file review. Web is in 780-16ba6421.md, shared in 780-1ea83a3c-50da-4942-a994-c4e222a6763d.md, UI in 780-9451c09b.md, desktop in 780-83698ae5.md and work-records in 780-33a69413-ded8-42f9-a3a1-0e1391557e21.md and 780-ab72f229.md. These reports record source boundaries and retention decisions. Their completed inventories supersede earlier pending-review statements.

One test was removed, StartingPage's self-comparing shared SVG geometry assertion in apps/desktop/src/window/starting-page.test.ts, with its unused import. No other test or assertion removal or consolidation is reported. Surviving starting-page checks retain startup, styling, reduced motion, safe messages and recovery. Visual parity remains outside that test coverage.

Restart retains all six real-process cases and real restart behavior. Its local refresh adapter removes a fixed 3950 ms schema wait and redundant successful startup. Ten prior repetitions passed without per-test timings. The review follow-up below records ten additional verbose repetitions under concurrent web and work-records load, including all margins. Tracker-sync retains all 21 cases, atomic sibling-file rename writes and read-only GET behavior. Its ten final repetitions passed after reproducing partial JSON reads. Explicit CLI deadlines address observed contention failures, not all possible scheduling delays. Publication retained its process crash and durable uncertainty checks and passed ten focused repetitions plus representative shared-package concurrency. The UI compilation helper retains finally cleanup. No production behavior changed in these fixes.

## Final checks and resource evidence

Root typecheck and knip both passed with exit 0. The supplemental sequential verbose restart command was pnpm --dir apps/server exec vp test run test/restart.test.ts --reporter=verbose. All six cases passed in 46.59 seconds wall. Per-test durations in file order were 4731, 11731, 5450, 6116, 7139 and 8956 ms against unchanged deadlines of 20000, 30000, 60000, 60000, 30000 and 30000 ms. The smallest observed margin was 15269 ms. Its per-test output and resource accounting are in restart-verbose.log. This supplements the prior repetitions but does not reconstruct their unavailable concurrency margins.

Baseline root accounting reported 725.18 seconds user CPU, 190.36 seconds system CPU, 1045004288 bytes maximum resident set size and zero swaps. Final root accounting reported 737.82 seconds user CPU, 193.96 seconds system CPU, 1082114048 bytes maximum resident set size and zero swaps. These observations do not prove or exclude historical memory pressure.

No new test, helper or runner configuration was necessary for this report-only aggregate slice. git diff --check passed. The evidence was captured before this documentation commit; its implementation SHA above therefore identifies the code tested.

## Review follow-up under concurrent workspace load

Measured on 2026-11-02 in the shared build checkout `feat-780-fix-slow-and-flaky-tests` at commit `abc1d6275c518dfdd92ea79efb90abb27944cffc`. Node 24.22.1 and pnpm 12.14.0 used `/opt/homebrew/opt/node@24/bin` first on PATH, followed by `/Users/pedrogomes/.local/bin`. LAR_FACTORY_DATA_DIR was `/Users/pedrogomes/Library/Application Support/Lar Factory`. Existing dependencies and build output were reused; no install, build, root suite or other intentional test load ran. Background machine activity was uncontrolled.

Each of ten sequential rounds launched `pnpm --dir apps/web test` and `pnpm --dir packages/work-records test` concurrently, then immediately ran `/usr/bin/time -l pnpm --dir apps/server exec vp test run test/restart.test.ts --reporter=verbose`. Default package workers remained enabled. The script waited for both load suites to finish normally before the next round and would stop after any failing round once both load processes had finished. All thirty commands exited 0. Every round passed six restart tests, 947 web tests and 253 work-records tests. No processes required termination.

Columns T1 through T6 follow source order: schema upgrade, closed-board write, successful start, failed start, older thread name recovery and uncertain recovery. Their unchanged deadlines are respectively 20000, 30000, 60000, 60000, 30000 and 30000 ms. Assertions and test code are unchanged. All per-test timings below are milliseconds; wall time is seconds.

| Round | T1 | T2 | T3 | T4 | T5 | T6 | Restart wall seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1592 | 6645 | 1560 | 1724 | 2250 | 2659 | 17.01 |
| 2 | 1503 | 6900 | 1884 | 2093 | 2015 | 2823 | 17.95 |
| 3 | 1596 | 4911 | 1573 | 1549 | 1687 | 2340 | 14.24 |
| 4 | 1549 | 6583 | 1584 | 1547 | 1575 | 2677 | 16.21 |
| 5 | 1510 | 6584 | 3642 | 1601 | 1710 | 2354 | 18.08 |
| 6 | 2460 | 4979 | 3555 | 3536 | 1688 | 2427 | 19.38 |
| 7 | 2092 | 5688 | 1506 | 1498 | 1694 | 2362 | 15.65 |
| 8 | 1880 | 6776 | 1563 | 1507 | 1714 | 2462 | 16.58 |
| 9 | 1517 | 6754 | 1727 | 1666 | 1863 | 2566 | 16.98 |
| 10 | 1750 | 6870 | 1801 | 1616 | 1840 | 2725 | 17.22 |

Across all 60 results, the slowest test was T2 in round 2 at 6900 ms. The closest deadline margin was T1 in round 6: 20000 minus 2460 equals 17540 ms remaining. There were zero failures. This demonstrates margins under this representative load, not arbitrary contention or a controlled speed improvement.

Full verbose logs and resource accounting are in `/tmp/780-restart-round1/restart-1.log` through `restart-10.log`. Concurrent load logs are `web-1.log` through `web-10.log` and `work-records-1.log` through `work-records-10.log` in that directory. `run.sh` records the exact orchestration, `conditions.log` records versions and tested SHA, and `status.log` records round, restart exit, web exit and work-records exit. These local logs are not portable artifacts; this table preserves all restart timings for review.
