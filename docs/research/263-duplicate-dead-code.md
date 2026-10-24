# Where the refactor removes duplicate and dead code

Research for [#263](https://github.com/maddec01/mux-factory/issues/263), part of the [#262](https://github.com/maddec01/mux-factory/issues/262) map. The question is where the refactor can remove code without changing behaviour.

## Answer

The refactor can delete about 240 lines without changing behaviour: about 145 in source and about 95 in tests. That is 2% of the 11,900 lines in `board/src`, `board/test`, `app/src` and `app/scripts`. The code has almost no dead code. Knip finds one wholly unused function (`isOnBoard`, 4 lines), no unused files and no unused dependencies. Most of the saving comes from small helpers repeated across the server's write handlers, the `execFile` wrappers and the server-level and page tests.

Splitting the five oversized modules into deeper modules moves code but deletes almost none. It is worth doing for locality and testability, not for the line count.

Line numbers below are from `main` at `f131a78`.

## Method

- Ran knip 5 (`npx knip --include files,exports,types,dependencies,devDependencies,unlisted`) in `board/` and `app/`, then checked each flag with `grep -w` across `board/` and `app/`.
- Read every module the issue names, plus `tools.ts`, `t3.ts`, `install-skills.ts`, the `board/src/app/` stores, `app/src/` and the tests.
- Counted a saving only where lines disappear. A move between files counts 0.

## 1. Dead code, unused files and unused dependencies

| Finding | Where | Saving |
|---|---|---|
| `isOnBoard` is wholly unused: no caller in `board/` or `app/` | `board/src/model.ts:311-314` | 4 |
| Exported but used only in their own file. Only the `export` keyword is dead: `viewItem`, `TOAST_MS`, `ToastView`, `getUpdateDisabledReason`, `boardRecordsDir`, `byFlowOrder`, `normalizeChecks`, `SLOW_CHECKS_MS`, `decisionType`, `DONE_WINDOW_MS`, `createInitialUpdateState`, `restartDelay`, `LABEL`, plus 39 exported types | knip output, both packages | 0 |
| `getUpdateDisabledReason` and `createInitialUpdateState` each have one caller in their file and can fold into it | `board/src/app/update-button-logic.ts:78-84`, `app/src/updates/updateMachine.ts:14-40` | 7 |
| Exported only for tests: `INSTALL_FLAG`, `ROOT_ENV`, `SkillInstallError`, `plan`, `plistPath` | `app/src/backend/SkillInstall.ts`, `LaunchAgentCleanup.ts` | 0, keep |
| A dead branch. `totalTokens([usage]) === 0` can't be true, because line 270 already returned when input plus output is 0 | `board/src/transcript-usage.ts:323` | 1 |

Knip's other `app/` flags are false positives because knip doesn't read the Vite+ config. It flagged all 20 test files, `preload.ts`, `scripts/sign-macos.ts` and `vite.config.ts` as unused files, and `@effect/vitest` and `@electron/osx-sign` as unused dependencies. The tests import `@effect/vitest`, `sign-macos.ts` imports `@electron/osx-sign`, `build-desktop-artifact.ts` names `sign-macos.ts` as electron-builder's sign hook, and `vite.config.ts` builds `preload.ts`. In `board/`, knip found no unused files or dependencies.

The older plain files in `board/src` (`slice-popover.ts`, `start-menu.ts`, `anchor.ts`, `brand-mark.ts`, `format.ts`) are not leftovers. The React page imports each of them.

One comment is stale. `app/src/backend/LaunchAgentCleanup.ts:2` names `board/scripts/install-launch-agent.sh`, and `board/scripts/` no longer exists.

## 2. Duplicate logic in source

### board/src/server.ts

| Finding | Where | Saving |
|---|---|---|
| Four write handlers open the same way: refuse in sample mode, `readJson`, return on null, check the session, require a string `itemId`. One `writeInput(req, res, { disabled, what, restarted })` replaces 26 lines with about 12 | `captureItem` 333-341, `moveItem` 393-396, `startItem` 411-418, `abandonItemRequest` 463-470 | 14 |
| Find the item or answer 404, three times | 397-398, 428-429, 476 | 2 |
| Each handler checks the other handlers' in-flight maps (`moving`, `abandoning`, `startHolds`). One `busyReason(id, action)` | 401-402, 431-432, 478-479 | 3 |
| A promise kept in a map by item id and deleted when it settles: `starts` and `abandoning`. `editPrStats` can fold into `syncPrStats` | 426-447, 471-491, 124-146 | 8 |
| Log when a flag flips, three times | 103-106, 107-110, 151-154 | 4 |
| `GUARDED_WRITES` and `guardedWrite` list the same six paths. One `Record<path, handler>` holds both | 36, 516-521 | 4 |

### The rest of board/src

| Finding | Where | Saving |
|---|---|---|
| Four `execFile` wrappers, each trimming stderr to its first 4 lines. One `runTool(file, args, { env, timeout })` that returns `{ code, stdout, stderr }` | `github.ts:321-332`, `t3.ts:26-35`, `tools.ts:64-68,137-146,163`, `repository-project.ts:38-43` | 11 |
| `countsOf` recounts the status groups `boardSections` already builds. Its only caller, `app/Header.tsx:33`, can read the section lengths | `model.ts:349-363`, `board-view.ts:43-63` | 8 |
| Read a JSON file, check it is a record, return null on failure, three times. One `readJsonRecord(path)` | `item-stats.ts:199-206`, `item-stats.ts:261-266`, `model-choices.ts:59-66` | 8 |
| The same JSON parse and object guard opens both transcript line parsers | `transcript-usage.ts:63-69`, `196-203` | 8 |
| `isRecord` written five times. `model-choices.ts` imports it from `item-stats.ts`, so it should live in one small shared module | `item-stats.ts:195`, `install-skills.ts:276-278`, `transcript-usage.ts:59,117`, `usage-pricing.ts:87,98,101` | 4 |
| The row types are written twice: in the casts and in `reader`'s nine positional parameters | `item-stats.ts:427-432`, `445-450` | 5 |
| `ROOTS` and `LINEAGE` both scan `projection_threads` and can be one query | `item-stats.ts:53-64` | 5 |
| `scaleTokenRates` and `sameTokenRates` spell out each rate field. A loop over the key list replaces them | `usage-pricing.ts:76-83`, `128-134` | 5 |
| Pagination loop written twice. The two differ in their error text and the project title, so the shared part is small | `github.ts:353-364`, `381-396` | 5 |
| A lazy file index repeated in the Claude and Codex readers | `transcript-usage.ts:416-419,435`, `489-498` | 4 |
| `` `Could not X. ${err instanceof Error ? err.message : ...}` `` three times. One `message(err)` | `github.ts:424,461,513` | 3 |
| The same Codex tier mapping twice | `transcript-usage.ts:184-188`, `item-stats.ts:333-337` | 3 |
| Project number fallback written twice | `github.ts:400,455` | 1 |
| `${HOME}/.t3/userdata` written twice | `item-stats.ts:26,31` | 1 |

### board/src/app and app/src

| Finding | Where | Saving |
|---|---|---|
| `LOGIN_SHELL_ENV_NAMES` (16 lines) is exactly `PATH` plus the three lists below it. Build it from them | `app/src/shell/ShellEnvironment.ts:20-35` | 14 |
| The three card actions repeat find, mark pending, post, show result | `board/src/app/card-actions.ts:73-136` | 6 |
| Set or clear one entry in a record keyed by item id, twice. One `setKey` | `action-store.ts:20-23`, `start-store.ts:31-34` | 5 |
| `refocus` repeated | `card-actions.ts:65-68`, `Toasts.tsx:27-29`, `recheck-store.ts:38` | 2 |

The 13 zustand stores are 14 to 101 lines each and mostly different. A generic store helper would save about 6 more lines and make each store harder to read, so it isn't counted.

Three apparent duplicates are not duplicates:
- The update state types live once, in `board/src/app/board-app.ts:17-86`, and `app/` imports them.
- `app/src/ipcChannels.ts` holds the IPC channel names once.
- `ShellEnvironment.ts` and `board/src/tools.ts` both read the login shell's PATH, but the board needs its own copy when it runs without the app. Skipping the board's read under the app would change behaviour, so it counts 0.

## 3. Duplicate logic in tests

| Finding | Where | Saving |
|---|---|---|
| The `until` polling helper copied into three files, and `ready` is the same idea. Move one copy to `test/server-support.ts` | `board/test/abandon.test.ts:11-18`, `queue.test.ts:8-15`, `drain.test.ts:16-22`, `start.test.ts:54-61` | 24 |
| `raw(...)` and `ref(...)` builders redefined about five times in `github.test.ts`, while `test/raw-items.ts` already has `rawIssue` and `sliceRef`. A third `rawIssue` lives in `server-support.ts:23-32` | `board/test/github.test.ts` near 91, 103, 115-121, 140, 159 | 17 |
| Read the session, then post, in four helpers. One `board.postSession(body, path)` | `abandon.test.ts:20-23,126-129`, `queue.test.ts:129-132`, `start.test.ts:63-66` | 10 |
| `type Board = Awaited<ReturnType<typeof startBoard>>` redeclared per file, and two draft fixtures that differ only in status | `abandon.test.ts:8-9`, `start.test.ts:51-52`, `queue.test.ts:6` | 5 |
| The page tests repeat the same `afterEach` that resets `fetchMock`, the same `holdPosts`, the same `posted`, and the one-line `text`, `toast`, `push` and `moved` helpers. Move them to `test/page/support.ts` | `board/test/page/card-actions.test.ts:12-32`, `start.test.ts:39-55`, `tool-notices.test.ts:12,27-29`, `toasts.test.ts:10-14`, `main.test.ts:140` | 29 |
| `tempDir` re-implemented twice in the stats test helpers, and JSONL serialisation twice | `board/test/stats-db.ts:74-75,168,192,244-245` | 5 |
| A one-line `tempDir` in four app tests, and the same skill bundle setup twice | `app/src/backend/ClaudeProfiles.test.ts:10,17-20`, `LaunchAgentCleanup.test.ts:11`, `SkillInstall.test.ts:10,14-17`, `app/src/updates/ChannelSetting.test.ts:10` | 5 |

The server tests already share process spawning and the fake `gh` through `startBoard` (`board/test/server-support.ts:44-102`).

Two more test merges save about 18 lines, but only if the copies stop matching T3 line for line. The Codex and Claude transcript fixtures in `board/test/transcript-usage.test.ts:13-33,123-147,275-306` overlap `board/test/stats-db.ts:141-146,198-212` and `item-stats.test.ts:367-371`. Lines 11 and 121 of `transcript-usage.test.ts` say those tests are ported from T3's tests. The total above leaves these 18 lines out.

## 4. Oversized modules and the deeper modules they could split into

The terms below are from `codebase-design`. Each split moves code and saves 0 lines. The deletions it enables are already counted above.

### board/src/server.ts (621 lines)

`server.ts` mixes nine jobs at module level:
- Bootstrap and global state (29-90).
- Stats and model choice enrichment (96-156).
- Tool health and retry (158-196).
- The refresh scheduler, plus the overlay of recent and abandoned items (198-244, 324-330).
- HTTP transport: headers, SSE, host and secret checks, `readJson` (249-322).
- Four write commands (332-494).
- Drain (496-533).
- The router (535-574).
- The process lifecycle (576-621).

Five module-level maps hold the locks (`starts`, `moving`, `abandoning`, `abandoned`, `submissions`).

The deeper modules:
- **Board state module.** It holds `state`, `recentItems`, `abandoned` and `push`, behind an interface of `snapshot`, `applyRead`, `showChanged` and `remove`.
- **Item commands module.** Queue, back to List, start and abandon move here, and the five lock maps become its private state. That gives locality: every rule about which action blocks which lives in one place.
- **HTTP adapter.** Transport and routing.

Today the only seam is the spawned process, so every server test starts one. With injected GitHub and t3 adapters, the item commands module could be tested in process. That makes the tests faster, not shorter.

### board/src/github.ts (520 lines)

`github.ts` has six parts:
- Query text (11-80).
- Raw shapes (82-170).
- Pure normalisation (172-317).
- The `gh` transport (319-341).
- Paginated reads (343-396).
- Writes (398-520).

The split is a pure `github-normalize` module with raw items in and `Item[]` out, which is most of what `github.test.ts` tests, and `github.ts` as the `gh` adapter. The `run` parameter on the writes is already a seam.

### board/src/item-stats.ts (545 lines)

`item-stats.ts` mixes eight jobs:
- T3 path lookups (25-50).
- T3 schema SQL (53-102, 277-299, 394).
- Interval maths (134-164).
- Settings, instance homes and pricing config (182-273).
- Codex tier history (301-366).
- Mapping threads to transcripts (368-391).
- `liveProjects` (396-415), which isn't about stats at all.
- Issue matching and the time model (112-126, 444-545).

The deeper modules:
- **T3 settings module.** Paths and settings. Its interface is `readT3Settings()`, which returns instance homes, overrides and aliases. `model-choices.ts` and `repository-project.ts` would then stop importing from `item-stats.ts`.
- **`t3-db.ts`.** It owns T3's schema: the SQL, the transcript mapping and `liveProjects`. ADR 0005 already asks for one module that reads the database and tolerates failure.
- **Agent time module.** Plain rows in, totals by `(repo, number)` out, testable without SQLite. This is the deep core.
- **A small pure `intervals.ts`.**

### board/src/transcript-usage.ts (500 lines)

`transcript-usage.ts` has five parts:
- Claude line rules (46-98).
- A Codex state machine (100-333, about 230 lines and the deepest part).
- Totals and dedupe (340-362).
- A module-level file cache (364-405).
- Session file discovery (407-500).

The seam is between the line parsers and the transcript store, which already has the `SessionRecordsReader` interface. Moving the Codex state machine to `codex-usage.ts` makes the parser modules deep and leaves the store as the one adapter over the file system.

### board/src/model.ts (363 lines)

`model.ts` is cohesive. It holds types plus pure rules and imports nothing. `countsOf` should go, as above. `itemTotal` (87-139) could move to a stats module, saving 0. No split is needed.

## 5. Totals

| Area | Lines saved |
|---|---|
| `server.ts` | 35 |
| Rest of `board/src` (`github.ts`, `t3.ts`, `tools.ts`, `model.ts`, the stats modules) | 71 |
| `board/src/app` and `app/src` | 13 |
| `ShellEnvironment.ts` env name list | 14 |
| Dead code and single-caller folds | 12 |
| Board server tests | 56 |
| Page tests | 29 |
| Stats and app test helpers | 10 |
| **Total** | **240** |
| Optional, if ported T3 fixtures may diverge | 18 more |
| Module splits | 0 |

The estimates are within about 20%. Each one assumes the helper replacing the copies is a few lines long.

## Open questions for Pedro

1. **Code copied from T3.** ADR 0011 keeps copied T3 code close to upstream "so later T3 fixes port the same way". Several findings edit copied or ported code: the `ShellEnvironment.ts` list (14 lines), the transcript parser helpers in `transcript-usage.ts` (about 12 lines) and the ported test fixtures (18 lines). Should the refactor leave T3 copies untouched, at a cost of about 44 lines, or accept the drift?
2. **Dead `export` keywords.** Removing the 13 value exports and 39 type exports that nothing imports saves no lines but narrows each module's interface. Should the refactor drop them and add knip to CI so they stay gone? The app needs a knip config that names the Vite+ entries first, or knip reports 20 false unused files.
3. **Splits.** The module splits in section 4 save 0 lines. Should the refactor do them, or only the deletions?
