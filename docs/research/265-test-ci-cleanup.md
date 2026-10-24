# Tests and CI on one quiet Vitest setup

Research for [#265](https://github.com/maddec01/mux-factory/issues/265), part of the
[#262](https://github.com/maddec01/mux-factory/issues/262) map. It answers what makes test and CI
output noisy, and what moving every TypeScript suite to one Vitest config takes.

## Method

- A fresh worktree of `main` at `f131a78`, set up with `bash scripts/setup-worktree.sh` (pnpm
  12.14.0, Node 22.23.3 locally).
- Ran `pnpm test` and `pnpm run typecheck` in `board/` and `app/`, every `.test.sh` suite that CI
  runs, and both `.github/scripts/*.test.cjs` suites.
- Vitest picks its `minimal` reporter when it detects an agent, and that reporter drops console
  output from passing tests (`configDefaults.reporters` in
  `vitest@5.0.5/dist/chunks/defaults.B1FCaFfh.js`). So the Vitest suites were run again with
  `--reporter=default`, which is what CI uses.
- Read the CI logs of run [40036053306](https://github.com/maddec01/mux-factory/actions/runs/40036053306)
  (the latest push to main), the failed main run
  [39976202018](https://github.com/maddec01/mux-factory/actions/runs/39976202018), and Conventional
  commits run [40035988657](https://github.com/maddec01/mux-factory/actions/runs/40035988657), plus
  the Tests job's annotations.
- Vitest facts come from the copy Vite+ 1.3.0 ships (Vitest 5.0.5) in `board/node_modules`. Node
  facts come from the Node docs and source.

Every suite passed and both typechecks were clean. Test counts today: 277 board server tests on
`node --test`, 177 page tests and 123 app tests on Vitest.

## Warnings and errors, grouped by cause

| # | Cause | Where it prints | Count |
|---|-------|-----------------|-------|
| 1 | Rolldown's `MODULE_LEVEL_DIRECTIVE` warning for `"use client"` in `@base-ui/react` (163) and `@base-ui/utils` (15) modules | `vp build` in `board/`, which `board`'s `pnpm test` runs and `app`'s `pnpm test` runs again | 180 warnings per build, about 1,800 lines. 2 builds locally (board, app), 1 in CI |
| 2 | React's duplicate key error: `Encountered two children with the same key, PVTI_sample01` | `test/page/add-item.test.ts`, "submitting posts the draft…" | 1 per run, every run |
| 3 | Effect log lines from the code under test (`Effect.logInfo` and `Effect.logError` in `app/src/updates/AppUpdates.ts:105,143,158`) | `app/src/updates/AppUpdates.test.ts` (20 tests) and `BoardSupervisor.test.ts` (1) | 56 INFO and 2 ERROR lines |
| 4 | The board server's own log, inherited by the test process (`stdio: ["ignore", "inherit", "inherit", "ipc"]` in `app/src/backend/BoardServer.ts:118`) | app tests | 3 lines |
| 5 | Vitest's performance hints (`Isolate 13 workers spawned… isolate: false` in CI, `Environment jsdom was created 13 times… vmThreads` locally) | board page tests | 1 hint, 2 to 3 lines |
| 6 | Node's test reporter. Node 22 uses `tap` when stdout is not a terminal; Node 23 made `spec` the default everywhere ([test.md](https://github.com/nodejs/node/blob/v24.x/doc/api/test.md#test-reporters), change in v23.0.0, PR #54548) | board server tests locally (about 1,670 TAP lines), Conventional commits job on the runner's Node (about 40) | Not a warning, but most of the remaining volume |
| 7 | `actions/checkout` runs `git init`, and git prints its `init.defaultBranch` hint | Every job that checks out | 13 lines per checkout |
| 8 | `pnpm/action-setup@v6` installs pnpm 11.19.0, then switches to 12.14.0 from `packageManager`, and warns `Detected a pnpm v10 installation layout at PNPM_HOME` | Tests job, Set up pnpm | 1 warning |
| 9 | GitHub's notice that macOS arm64 runners may queue longer | Tests job annotation | 1 notice, from GitHub, not fixable here |

Notes on the causes:

1. Vite+'s build drops only `CIRCULAR_DEPENDENCY` and `THIS_IS_UNDEFINED` warnings
   (`warningIgnoreList` in `vite-plus-core/dist/vite/node/chunks/node.js:40158`) and hands
   everything else to `build.rolldownOptions.onLog` or `onwarn` when the config sets one (same
   file, lines 40200 to 40206). A filter on `code === 'MODULE_LEVEL_DIRECTIVE'` for `"use client"`
   in `board/vite.config.ts` removes all 180. Rolldown explains the warning at
   [rolldown.rs/in-depth/directives](https://rolldown.rs/in-depth/directives#other-directives).
   The page has no server components, so dropping the directive changes nothing.
2. The test adds `{ ...sample.items[0]!, title: 'Playback stalls', number: 501 }`
   (`board/test/page/add-item.test.ts:123`), which copies the first item's `id`. `BoardView.tsx`
   keys cards by `id`. The fix is a new `id` in the fixture. It is a test bug, not a page bug.
3. and 4. Vitest's `silent: 'passed-only'` hides console output of passing tests and keeps it for
   failing ones (`silent?: boolean | "passed-only"`, `vitest/dist/chunks/plugin.d.C8mmycim.d.ts:3746`).
   That covers the Effect logger and anything a child writes through the test process. A quieter
   alternative for 3 is a test layer that drops logs below `Error`.
5. `test.experimental.diagnostics: false` turns the hints off (`plugin.d.C8mmycim.d.ts:4245`).
   Setting `pool` or `isolate` explicitly also does, because "Hints never suggest changing options
   that were set explicitly" (`vitest/dist/chunks/cac.CLrZKo1g.js`, `diagnostics`).
6. Goes away for the server suites once they run on Vitest. The `.cjs` suites can pass
   `--test-reporter=spec`.

`pnpm run typecheck` printed nothing but its command line in both packages. The shell suites
(`setup-worktree`, `slice`, `status`, `preview-copy`, `release-secrets`) printed only their own
`ok` lines and `all passed`.

## The ENOTEMPTY flake

**Cause.** A board's `gh` child process outlives the board and writes into the temp home while
the test deletes it.

1. `startBoard` (`board/test/server-support.ts:44`) makes a temp home, spawns `src/server.ts`, and
   registers cleanup that sends SIGTERM to the board, waits for its `exit`, and runs
   `rm(dir, { recursive: true, force: true })` (lines 76 to 79).
2. The board runs `gh` through `execFile` (`board/src/github.ts:325`). On SIGTERM it closes the
   server and exits (`board/src/server.ts:613`), but it does not wait for or kill `gh` children
   still running. They live on as orphans.
3. The fake `gh` reads its state file, then appends its arguments to `github.json.calls`
   (`board/test/fake-gh.cjs:5-6`). When that append lands after `rm` has unlinked the file but
   before `rm` removes the folder, it creates the file again, and the final `rmdir` fails with
   `ENOTEMPTY`.
4. The tests with a 100 ms refresh (`fastRefresh`, `test/fast-refresh.ts`) spawn a project read
   every 100 ms, so one is often in flight at cleanup. Seven server tests and one abandon test use
   it. PR #228 reported the flake on "PR edits run beside the refreshes…", one of them.

**Evidence.** `$TMPDIR` on this Mac holds 30 leftover `mux-board-test-*` folders. 9 of them hold
nothing but `github.json.calls` with a single line, a project `graphql` read: the file a late
fake `gh` wrote after `rm` had emptied the folder. Node's `rm` retries `ENOTEMPTY` only when
`maxRetries` is set, and its default is 0
([fs.md](https://github.com/nodejs/node/blob/v22.x/doc/api/fs.md#fspromisesrmpath-options);
`retryErrorCodes` in `lib/internal/fs/rimraf.js`).

**Fix, in the tests only.** Spawn the board with `detached: true`, so it leads a new process group
that its `gh` children join, and stop it with `process.kill(-child.pid)` so the children die with
it ([child_process `options.detached`](https://nodejs.org/api/child_process.html#optionsdetached)).
Then add `maxRetries: 5` to the `rm` calls as a second guard. Retries alone are not enough: a
fake `gh` with `prEditDelay` writes `github.json` again 1.5 s after it starts.

The failed main run 39976202018 is a different flake in the same test: the last assertion saw
`['read', 'PATCH', 'read']` instead of `['read', 'PATCH']`, a second sync on a slow runner. Its
cause was not traced here.

## What the node --test suites need under Vitest

The scope is 27 files in `board/test/*.test.ts` (4,020 lines) and the helpers `server-support.ts`,
`stats-db.ts`, `repo-support.ts`, `raw-items.ts` and `fast-refresh.ts`.

| node:test today | Uses | Vitest 5 | Work |
|---|---|---|---|
| `import { test } from 'node:test'` | 34 files | `import { test } from 'vite-plus/test'`, as the page tests already do | Mechanical |
| `type TestContext` from `node:test` | 12 files, every helper that takes `t` | `TestContext` from `vite-plus/test` | Mechanical |
| `t.after(fn)` | 22 calls, mostly temp folders and stopping boards | `t.onTestFinished(fn)`. It runs in reverse order of registration and does not run after a dynamic `ctx.skip()` (`config.d.QBNYCgFU.d.ts:2202-2204`) | Mechanical. No call registers cleanup before a skip |
| `return t.skip(reason)` | 4 tests in `install-skills.test.ts`, when run as root | `test.skipIf(process.getuid?.() === 0)` | Small |
| `t.mock.method(fs, 'renameSync', …)` with `syncBuiltinESMExports()` | 2 tests in `install-skills.test.ts` | `vi.spyOn(fs, 'renameSync')`, keeping `syncBuiltinESMExports()`. Vitest does not bundle `node:fs` for Node tests, so the call should still update the named import in `src/install-skills.ts:4`. Check it in the first build | Small, needs a check |
| `node:assert/strict` | all files | Works in Vitest as is | None, or a later switch to `expect` |
| No per-test timeout (Node's default is `Infinity`, [test.md](https://nodejs.org/docs/latest-v22.x/api/test.html)) | subprocess tests take up to 18 s in CI | `testTimeout` defaults to 5,000 ms and `hookTimeout` to 10,000 ms (`cac.CLrZKo1g.js:1011-1016`) | Set `testTimeout: 60_000` on the server project |
| One child process per file, files in parallel | | Vitest's default pool is `forks`, with `isolate: true`, files in parallel | Same model |
| The built `dist/` | `server.ts` serves it at startup, `repo-support.ts:41` copies it | Unchanged: build first, as the scripts already do | None |
| Temp folders | `mkdtemp` under `tmpdir()` | Unchanged | The ENOTEMPTY fix above |
| Timers | Real timers. The child boards get `--import fast-refresh.ts`, which is a Node flag on the child, not the runner | Unchanged | None |
| `process.env` | No test changes it | Vitest's `unstubEnvs` is not needed | None |

The two `.cjs` suites in `.github/scripts` are CommonJS, not TypeScript. They run where no
dependencies are installed: Conventional commits on ubuntu with no install step, and Release's Plan
job. Moving them to Vitest would add an install to both jobs.

Cost: about 100 changed lines across the 34 files and one config, nearly all import swaps and
`t.after` renames, plus the ENOTEMPTY fix. The 248 `test(` blocks keep their bodies.

## Proposed shared Vitest layout

`board/` and `app/` are separate pnpm packages, each with its own lockfile and `node_modules`
(`board/pnpm-workspace.yaml` and `app/pnpm-workspace.yaml` hold settings only). The repo root has
no `node_modules`, so a root config cannot import `vite-plus`. Until #266 decides on workspace
packages, the layout below keeps one shared file and one config per package.

`board/vitest.shared.ts`, imported by both packages. `app/` already depends on `../board`.

```ts
import type { UserConfig } from 'vite-plus';

/** Test options every suite shares: logs only from failing tests, no performance hints. */
export const sharedTest = {
  silent: 'passed-only',
  experimental: { diagnostics: false },
} satisfies UserConfig['test'];
```

`board/vite.config.ts` declares two inline projects. `extends: true` gives both the page's plugins.

```ts
test: {
  ...sharedTest,
  projects: [
    { extends: true, test: { name: 'server', environment: 'node', include: ['test/*.test.ts'], testTimeout: 60_000 } },
    { extends: true, test: { name: 'page', environment: 'jsdom', include: ['test/page/**/*.test.ts'] } },
  ],
},
build: { outDir: 'dist', rolldownOptions: { onwarn: dropUseClientDirective } },
```

`app/vite.config.ts` keeps its `include` and `testTimeout: 15_000` and adds `...sharedTest` and
`name: 'app'`.

Scripts, so each suite keeps its own command:

| Package | Script | Command |
|---|---|---|
| board | `test` | `vp build && vp test run` (both projects) |
| board | `test:server` | `vp build && vp test run --project server` |
| board | `test:page` | `vp test run --project page` |
| app | `test` | `pnpm --dir ../board run build && vp test run` (unchanged) |

`test/page/support.ts` stays the page tests' shared setup, imported by each file. The server
helpers stay in `test/*-support.ts` and `stats-db.ts`, typed with Vitest's `TestContext`. If #266
makes a pnpm workspace, the shared file moves to the root and a root `vite.config.ts` lists
`board` and `app` under `test.projects`. A project that points at a config with its own `projects`
becomes a container for them (`plugin.d.C8mmycim.d.ts:3668-3674`).

## CI changes

The workflow name `CI` and the job name `Tests` stay. Branch protection and the Release workflow
read both (`.github/workflows/ci.yml:1-2`).

Steps of the Tests job, in order:

1. Configure git's default branch before checkout: `git config --global init.defaultBranch main`.
   This removes the 13-line hint (cause 7).
2. Check out repository, Set up pnpm, Set up Node (unchanged).
3. Install board dependencies (unchanged, `id: install`).
4. Install app dependencies: `pnpm install --frozen-lockfile` in `app/` (`id: app_install`). The
   app's tests and typecheck need no Electron binary: the tested modules import `electron` as types
   only, and `allowBuilds` keeps `electron`'s download off (`app/pnpm-workspace.yaml`).
5. Build the board page: `pnpm run build` in `board/`, once. The test steps after it call
   `vp test run --project …` directly, so the build output prints once.
6. Board server tests: `vp test run --project server` in `board/`.
7. Board page tests: `vp test run --project page` in `board/`.
8. Board typecheck (unchanged).
9. App tests: `vp test run` in `app/`, with `if: ${{ !cancelled() && steps.app_install.outcome == 'success' }}`.
10. App typecheck: `pnpm run typecheck` in `app/`, same condition.
11. The shell and `.cjs` steps as today. Add `--test-reporter=spec` to `node --test` for the
    release plan step, and in the Conventional commits workflow.

Vitest adds its `github-actions` reporter when `GITHUB_ACTIONS` is `true` (`configDefaults.reporters`),
so a failing test also shows as an annotation on the PR.

Two more things CI does today that differ from a local run:

- `actions/setup-node` reads `node-version-file: board/package.json`, and `engines.node` is
  `>=22.18`, so CI resolved Node 24.22.1 while local runs used 22.23.3. A `.node-version` file
  read by both setup-node and local tools would pin one version.
- The pnpm warning (cause 8) comes from action-setup's own install switching pnpm major versions.
  It needs a trial run on a branch: `standalone: true`, or an action-setup release that installs
  pnpm 12 directly.

## Open questions for Pedro

1. Do the `.cjs` suites (`release-plan`, `conventional-commits`) stay on `node --test`? Moving them
   adds a dependency install to the Conventional commits job and Release's Plan job.
2. Where does the shared config live before #266: `board/vitest.shared.ts`, as proposed, or wait
   for #266 and put it at the root of a workspace?
3. Should CI pin Node with a `.node-version` file, and to which version, 22 or 24?
4. Hide test logs with `silent: 'passed-only'` alone, or also give the app tests a logger layer that
   drops INFO lines?
