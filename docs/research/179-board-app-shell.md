# Board app shell and self-update: copy T3 Code (#179)

Research for #179, part of the map in #129. Researched 2026-10-23.

Pedro changed the question partway through. The board app copies T3 Code's approach: the same shell, the same full download-and-reinstall update, the same release pipeline, with the board's own UI and no sidebar. The earlier goal of swapping only the board code is dropped. The last section keeps a short note on the other shells I had started comparing.

Sources:

- T3 Code repository, `pingdotgg/t3code` at commit `4812dcad` (2026-10-23), cloned read-only. Paths below are relative to that repository.
- The installed `T3 Code (Nightly).app` 0.1.2-nightly.20261022.3541 on this Mac.
- Official docs from Electron, electron-builder, Squirrel.Mac and Apple, linked inline.
- Experiments I ran on this Mac, each marked "measured".

## Answer

T3 Code is an Electron app: Electron 44.9.3, which bundles Node 24.22.0 and Chromium 152 (`apps/desktop/package.json`, and the framework strings in the installed app). It updates with electron-updater 6.8.9 from GitHub Releases. CI builds, signs, notarizes and publishes those Releases with electron-builder 26.16.1. T3 Code is MIT licensed (`LICENSE`, "Copyright (c) 2026 T3 Tools Inc."), so the board app can copy its code as long as the copyright and licence notice go with the copied parts.

The board server runs unchanged under Electron's own Node. Measured: `ELECTRON_RUN_AS_NODE=1 "T3 Code (Nightly)" --disable-warning=ExperimentalWarning src/server.ts` served the sample board with HTTP 200. Type stripping and `node:sqlite` (SQLite 3.53.4) both work, including for a `.ts` file read from inside an `app.asar` archive.

The one hard requirement is a Developer ID certificate. On macOS, electron-updater hands the download to Squirrel.Mac, and Squirrel.Mac accepts the new bundle only if it meets the running app's designated requirement. An ad-hoc signature's designated requirement is its own code hash, so no later build can meet it (details in "Signing and Gatekeeper").

## 1. Desktop app structure

### Processes and layout

- `apps/desktop/src/boot.ts` loads the compile cache, then `main.cjs`. Vite+ (`vp pack`, `apps/desktop/vite.config.ts`) bundles the main and preload code to CommonJS in `dist-electron/`, with `electron` external.
- The main process is split into Effect services under `apps/desktop/src/`:
  - `app/`: lifecycle, environment, user data, CLI shim
  - `backend/`: spawns and supervises the server
  - `window/`: BrowserWindow, menu, quit hold
  - `updates/`
  - `ipc/`
  - `shell/`: login-shell environment
- The preload is `apps/desktop/src/preload.ts`. At line 77 it calls `contextBridge.exposeInMainWorld("desktopBridge", …)`. The bridge exposes branding (`getAppBranding`), the backend URL and token, and the update calls at lines 268-287: `getUpdateState`, `onUpdateState`, `checkForUpdate`, `downloadUpdate`, `installUpdate` and `setUpdateChannel`.
- The renderer is `apps/web`, a React app. A privileged custom protocol `t3code://app/` serves its built files from `apps/server/dist/client` (`apps/desktop/src/electron/ElectronProtocol.ts:15-29, 117, 226-267`). The renderer then talks to the backend over HTTP and WebSocket with a token.
- The window uses `contextIsolation`, `sandbox: true` and `nodeIntegration: false`, with a minimum size of 840x620 (`apps/desktop/src/window/DesktopWindow.ts`, around lines 385-410).
- electron-builder has no config file. `scripts/build-desktop-artifact.ts` builds the config in code:
  - appId `com.t3tools.t3code` (line 65)
  - mac targets `[dmg, zip]` (line 2884)
  - entitlements (lines 2923 and 3865)
  - a DMG background per channel (lines 2930-2936)
  - the GitHub publish config (lines 2738-2762)

### Native Mac title bar

- Window options: `getWindowTitleBarOptions` in `apps/desktop/src/window/DesktopWindow.ts:232-252`.
  - On macOS it sets `titleBarStyle: "hiddenInset"` and `trafficLightPosition: { x: 16, y: 52 / 2 - 7 }`, which centres the 14 pt buttons in a 52 px top bar.
  - The constants are at lines 39-43: `TITLEBAR_HEIGHT = 40`, `MACOS_WORKSPACE_TOPBAR_HEIGHT = 52` (commented "Matches --workspace-topbar-height in apps/web/src/index.css") and `MACOS_WINDOW_BUTTON_RADIUS = 7`.
  - `syncMacosWindowButtons` (lines 45-54) moves the buttons again when the zoom factor changes and after leaving full screen.
  - On Windows and Linux the window uses `titleBarStyle: "hidden"` plus `titleBarOverlay`, which draws native window controls over the page. Electron documents both modes in its [custom title bar guide](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar).
- Title content: everything right of the traffic lights is plain HTML in the renderer.
  - The row is `apps/web/src/components/sidebar/SidebarChrome.tsx:50-75`, 52 px tall (`h-[var(--workspace-topbar-height)]`). It gets the `drag-region` class when running in Electron.
  - `SidebarBrandMark` (lines 115-130) draws the T3 wordmark, then "Code", then the stage label ("Nightly" or "Beta") as a `Badge`.
  - The stage label comes from `desktopBridge.getAppBranding().stageLabel` (`apps/web/src/branding.ts`).
- Dragging: `apps/web/src/index.css:1747-1766`.
  - `.drag-region` sets `-webkit-app-region: drag`.
  - Children reset to `initial`, because Electron 44 passes the property down to children.
  - Buttons, inputs and links get `no-drag`.
- Room for the traffic lights: `apps/web/src/lib/windowControlsOverlay.ts` toggles the `electron` and `wco` classes. `apps/web/src/components/ui/sidebar.tsx:167` sets `--workspace-titlebar-content-left` so content starts after the buttons.
- Electron detection: `apps/web/src/env.ts:5` (`isElectron = window.desktopBridge !== undefined`).

T3's brand mark sits in the sidebar header. The board has no sidebar, so it needs a full-width 52 px top bar of its own:

- left padding for the traffic lights
- the Mux logo, "Factory" and a "for T3 Code" badge
- the update button at the right end

The Electron window options and the drag CSS carry over unchanged. Prototyping this bar is #183.

### Frontend libraries

From `apps/web/package.json` and the `pnpm-workspace.yaml` catalog:

- React 19.3.0
- Vite through `vite-plus`
- Tailwind CSS 4.3.3 (`@tailwindcss/vite`)
- `@tanstack/react-router` (hash history in Electron, `apps/web/src/main.tsx:21`)
- `@base-ui/react` components in shadcn style with `class-variance-authority` and `tailwind-merge`, and no Radix
- `lucide-react` icons
- `zustand` and Effect for state

The board today is server-rendered HTML with a hand-written `client.ts` and `styles.css`. Moving to this stack is optional for the shell, but it is what T3's title bar and update UI components are written in.

### Running the backend

- Spawn config: `apps/desktop/src/backend/DesktopBackendConfiguration.ts`, around lines 515-560. It runs `process.execPath` (the Electron binary) with `ELECTRON_RUN_AS_NODE=1` on `apps/server/dist/bin.mjs --bootstrap-fd 3`. When packaged, the working directory is the user's home. Electron documents `ELECTRON_RUN_AS_NODE` as "Starts the process as a normal Node.js process" ([environment variables](https://www.electronjs.org/docs/latest/api/environment-variables)). It works only while the `runAsNode` [fuse](https://www.electronjs.org/docs/latest/tutorial/fuses) is on.
- Supervision: `apps/desktop/src/backend/DesktopBackendManager.ts`.
  - It writes a bootstrap JSON (port, host, home and auth token) to fd 3 (lines 399-444).
  - Ports are scanned from 3773 (`apps/desktop/src/app/DesktopApp.ts:40, 88`).
  - Readiness polls `/.well-known/t3/environment` every 100 ms, with a 1-minute timeout.
  - Crash restarts back off from 500 ms to a 10 s cap.
  - Shutdown sends SIGTERM, then force-kills after 5 s.
- PATH: `apps/desktop/src/shell/DesktopShellEnvironment.ts` runs `$SHELL -ilc`. It copies `PATH`, the `HOMEBREW_*` variables and `SSH_AUTH_SOCK` into `process.env` (lines 76-90 and 307-317), and falls back to `launchctl getenv PATH` (lines 320-325). `DesktopApp.ts:262-270` applies the result before it spawns the backend. An app started from Finder otherwise gets launchd's minimal PATH and cannot find Homebrew's `gh`.

## 2. Update mechanics

### Main process

- `apps/desktop/src/electron/ElectronUpdater.ts` is a thin wrapper around electron-updater's `autoUpdater`.
- Feed: production builds never call `setFeedURL`. electron-builder writes `Resources/app-update.yml` at build time. In the installed nightly it reads `provider: github`, `owner: pingdotgg`, `repo: t3code`, `releaseType: prerelease`, `channel: nightly`. `setFeedURL` is used only for a local mock server (`scripts/mock-update-server.ts`, `DesktopUpdates.ts:1051`).
- Setup: `apps/desktop/src/updates/DesktopUpdates.ts`.
  - Lines 1066-1072 set `autoDownload = false` and `autoInstallOnAppQuit = false`.
  - Around line 457, `channel` is set, and `allowPrerelease`, `allowDowngrade` and `fullChangelog` are true only on the nightly channel.
  - `apps/desktop/src/updates/updateChannels.ts` treats `x.y.z-nightly.YYYYMMDD.N` versions as `nightly` and everything else as `latest`.
- Check loop: `AUTO_UPDATE_STARTUP_DELAY = "15 seconds"` and `AUTO_UPDATE_POLL_INTERVAL = "4 minutes"` (`DesktopUpdates.ts:52-53`). The first check runs 15 s after launch, then the check repeats every 4 minutes with `Effect.forever`. A lock serialises check, download, install and channel change.
- Download: the user starts it (`DesktopUpdates.ts:532-582`). Updater events (`update-available`, `download-progress`, `update-downloaded`, `error`) feed a reducer in `apps/desktop/src/updates/updateMachine.ts`. The states are `disabled`, `idle`, `checking`, `available`, `up-to-date`, `downloading`, `downloaded` and `error`.
- Install and restart (`DesktopUpdates.ts`, about lines 700-770):
  1. It marks the app as quitting and writes a restart marker and `desktop-update-install.json`.
  2. It stops the backends with a 5 s timeout.
  3. It calls `quitAndInstall({ isSilent: true, isForceRunAfter: true })`.
  4. If the install fails, it restarts the backends.
- How macOS applies it: electron-updater's `MacUpdater` passes the downloaded zip to Electron's native `autoUpdater`, which is Squirrel.Mac (installed app, `main.cjs` line 83693: `this.nativeUpdater = require("electron").autoUpdater`). Squirrel swaps the whole app bundle and relaunches it. Every update is a full new app, about 158 MB for the arm64 zip.
- IPC (`apps/desktop/src/ipc/channels.ts:23-28`): a push channel `desktop:update-state`, sent to every window, plus request channels for get-state, check, download, install and set-channel.
- `apps/desktop/src/updates/DesktopRemoteUpdates.ts` and `remoteUpdateFlow.ts` let a remote T3 client tell this desktop to update itself. The board does not need them.

### Update button and changelog

- `apps/web/src/state/desktopUpdate.ts` subscribes to `onUpdateState` and keeps the state in a store.
- The button is `apps/web/src/components/sidebar/SidebarUpdatePill.tsx`, placed at the end of the sidebar header menu (`SidebarChrome.tsx:226`). It uses `DesktopUpdateStatusIcon.tsx` and lucide icons.
  - A click downloads or installs, depending on `resolveDesktopUpdateButtonAction` (`apps/web/src/components/desktopUpdate.logic.ts:48`).
  - The tooltip text comes from `getDesktopUpdateButtonTooltip` (same file, line 93).
- The changelog on hover is a Base UI `Popover` with `openOnHover` (`SidebarUpdatePill.tsx:515`). It renders `SidebarUpdateReleaseNotes.tsx`, with links to the GitHub Releases. T3 shows it only on the nightly channel when notes exist.
- Where the text comes from:
  1. CI creates each Release with GitHub's `generate_release_notes: true` (`.github/workflows/release.yml:915, 931`), which is the "What's Changed" list of merged PR titles since the previous tag.
  2. electron-updater reads the Release bodies into `info.releaseNotes`. With `fullChangelog`, that is one entry per newer Release.
  3. `apps/desktop/src/updates/releaseNotes.ts` strips HTML and Markdown, removes duplicates and caps the result at 6 releases, 8 items each, 220 characters per item.
  4. The result goes into the update state and reaches the renderer through the `desktop:update-state` push.

Mux PR titles already follow conventional commits, so GitHub's generated notes give a readable changelog without extra work.

## 3. CI pipeline

- Triggers (`.github/workflows/release.yml:3-26`):
  - A pushed `v*.*.*` tag makes a stable release.
  - A cron at `"8,38 * * * *"` makes a nightly.
  - `workflow_dispatch` takes a channel (`preview`, `stable` or `nightly`).
- Nightly gate: `.github/scripts/check-nightly-release.cjs` cuts a nightly only if main has moved past the last nightly tag and that nightly is at least 6 hours old (`MINIMUM_RELEASE_GAP_MS`, line 1).
- Stable: a stable release rebuilds the latest nightly's commit.
- `ci.yml` runs on pull requests and pushes and publishes nothing.
- Version (`scripts/resolve-nightly-release.ts:115`): `${baseVersion}-nightly.${YYYYMMDD}.${github.run_number}`, where `baseVersion` is `apps/desktop/package.json` `version`. The tag is `v<version>`.
- Build matrix: `release.yml` calls the reusable `.github/workflows/release-desktop.yml` for each target, about lines 584-700.
  - mac arm64 and mac x64 build on macOS runners, as dmg plus zip.
  - Linux x64 and arm64 build as AppImage.
  - Windows x64 and arm64 build as NSIS on Linux runners, signed with jsign.
  - Each target runs `scripts/build-desktop-artifact.ts`.
- macOS signing: `release-desktop.yml:12-36, 438-494`.
  - It uses secrets `CSC_LINK` and `CSC_KEY_PASSWORD` (the Developer ID Application certificate), plus `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and the variable `APPLE_TEAM_ID`.
  - `scripts/sign-macos.ts` wraps `@electron/osx-sign`. electron-builder's built-in notarization runs from the `APPLE_API_*` variables.
  - Without the secrets, the build is unsigned and the workflow still passes.
  - The installed app confirms the result: `Authority=Developer ID Application: T3 Tools, Inc.`, `Notarization Ticket=stapled`, hardened runtime.
- Windows signing uses Azure Trusted Signing (`release-desktop.yml:497-512`).
- Publishing (`release.yml`, `release` job, lines 734-941):
  - `scripts/merge-update-manifests.ts` merges the per-arch feed files.
  - `softprops/action-gh-release@v3` uploads dmg, zip, blockmap, yml, AppImage and exe files plus `SHA256SUMS`.
  - Nightlies are `prerelease: true` and `make_latest: false`.
- Feed files on the live nightly `v0.1.3-nightly.20261023.3566`: `nightly-mac.yml`, `nightly.yml` (Windows) and `nightly-linux.yml`. Stable Releases use the `latest-` prefix. `nightly-mac.yml` lists each zip and dmg with its `sha512` and `size`, plus a `releaseDate`. electron-builder's [auto-update doc](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md) states that the zip target "is required for Squirrel.Mac, otherwise latest-mac.yml cannot be created".

## 4. Running the board inside this structure

What the board app needs, smallest first:

1. Spawn the server. The main process starts `board/src/server.ts` as a child, either with `child_process` and `ELECTRON_RUN_AS_NODE=1` the way T3 does it, or with Electron's [`utilityProcess.fork`](https://www.electronjs.org/docs/latest/api/utility-process). It passes `--disable-warning=ExperimentalWarning` and a free `BOARD_PORT`, waits for HTTP 200, then loads `http://127.0.0.1:<port>` in the window. No build step is needed for the server (measured above). T3's custom protocol and fd 3 bootstrap only matter if the board needs auth or a static renderer, and it needs neither on 127.0.0.1.
2. Copy `DesktopShellEnvironment.ts`. Without the login-shell PATH, `gh` (`board/src/github.ts:10`), `t3` (`board/src/t3.ts:6`) and `git` fail when the app is started from Finder.
3. Move config. `board/src/config.ts:18` reads `config.json` from the checkout. The app bundle is read-only and signed, so config moves to `~/Library/Application Support/<app>/`. First-run setup is #180.
4. Remove the git-based update. Drop `scripts/update.ts` and its spawn at `board/src/server.ts:377`, plus the launch agent.
5. Copy the update code. Take `ElectronUpdater.ts`, `updateMachine.ts`, `DesktopUpdates.ts` without the remote-update and channel-switching parts, `releaseNotes.ts`, the IPC channels and the preload bridge. Add an update button with the hover changelog in the board's own top bar.
6. Copy the window code. Take `getWindowTitleBarOptions`, `syncMacosWindowButtons` and the drag-region CSS. Build a top bar component with the Mux logo, "Factory" and a "for T3 Code" badge.
7. Copy the release pipeline. Take `build-desktop-artifact.ts` (cut down to mac), `sign-macos.ts`, `release-desktop.yml` and the `release` job, `merge-update-manifests.ts` and `generate_release_notes`. The trigger changes from a cron to a `workflow_run` on CI completing with `success` on `main`, so every green merge makes a Release. With a single channel, `x.y.<run_number>` versions and `make_latest: true` give a `latest-mac.yml` feed. mux-factory is public, so the GitHub provider needs no token.
8. Install skills on update. Running `scripts/install.sh` from bundled resources after each update needs a decision; this is the "skills without a checkout" fog in #179.

Measured cost: the server alone used 116 MB RSS under Electron's Node and 96 MB under Node 22. The Chromium browser, GPU and renderer processes come on top of that; I did not measure them. Electron Framework takes 237 MB on disk in T3's app, and T3's full arm64 zip is 158 MB.

Windows and Linux later: T3's matrix already covers both. Adding a target is one more `release-desktop.yml` matrix entry plus the `titleBarOverlay` branch that `getWindowTitleBarOptions` already has. Windows signing needs its own certificate or Azure Trusted Signing. Linux AppImages are unsigned, and electron-updater supports them.

## Signing and Gatekeeper

- What Squirrel checks: electron-builder says "macOS application must be signed in order for auto updating to work", and Electron's [autoUpdater doc](https://www.electronjs.org/docs/latest/api/auto-updater) says the same for Squirrel.Mac. Squirrel.Mac checks that the downloaded bundle "meets the designated requirement of the current application" (`Squirrel/SQRLCodeSignature.h` in [Squirrel.Mac](https://github.com/Squirrel/Squirrel.Mac)).
- Why ad-hoc fails: an ad-hoc signature's designated requirement is a code hash. Measured with `codesign -d -r-` on an ad-hoc signed binary: `designated => cdhash H"3268…"`. Every new build has a different hash, so every update fails the check. With a Developer ID, the requirement names the team and certificate, so new builds pass.
- Installing an unsigned or ad-hoc app: since macOS Sequoia, Control-click Open no longer bypasses Gatekeeper ([Apple developer news](https://developer.apple.com/news/?id=saqachfa)). The teammate tries to open the app, then clicks Open Anyway in System Settings > Privacy & Security and enters their password ([Apple support 102445](https://support.apple.com/en-us/102445)). Tauri's signing docs add that an unsigned arm64 app downloaded in a browser may show as "damaged" ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
- What a Developer ID needs: membership in the Apple Developer Program, which costs $99 a year according to Tauri's signing page (Apple's own page does not state the price). Only the team's Account Holder can create a Developer ID certificate ([Apple Developer ID](https://developer.apple.com/developer-id/)). Notarization uses `notarytool` with an App Store Connect API key, which is what T3's CI does. Whose account to use belongs to #181.
- With a Developer ID, the download is notarized and stapled, so it opens without the Privacy & Security step. Squirrel's in-app updates do not go through a browser download, so they cause no quarantine prompt.
- Not verified: Apple's `LSFileQuarantineEnabled` page did not render, so I could not confirm from Apple that files an app downloads itself skip quarantine by default.

## Recommendation

Copy T3 Code:

- Electron with the board server as an `ELECTRON_RUN_AS_NODE` child, with the source unchanged
- electron-updater with the GitHub provider, checking 15 s after launch and every 4 minutes, user-started download, and `quitAndInstall` to restart
- release notes from GitHub's generated PR-title notes, shown on hover
- an electron-builder and GitHub Actions release on every green merge to main
- signing and notarizing with a Developer ID

Trade-offs:

- A Developer ID is required. Without it, the full-bundle update cannot work on macOS, and every teammate clicks through Privacy & Security on install. Skipping it would mean writing our own updater instead of copying T3's.
- Every update downloads the whole app, about 150 MB, and restarts it. electron-updater supports blockmap differential downloads to reduce the size. Pedro accepted the full reinstall.
- Electron costs about 240 MB on disk plus Chromium's processes. In return it uses the same engine and Node as T3 Code, which makes T3's title bar, update UI and CI straightforward to copy.
- T3's code depends heavily on Effect services and Vite+. Copying it means either taking those dependencies or rewriting the parts in plain TypeScript. The update and window logic is a few hundred lines once the remote-update and channel features are removed.

## Other shells (short note from before the change of direction)

- Tauri's updater requires its own minisign signature, which "cannot be disabled". It does not depend on Apple's designated requirement, so it works for ad-hoc signed apps ([Tauri updater](https://v2.tauri.app/plugin/updater/)). Tauri has no Node, so the server would ship as a sidecar binary ([Tauri Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)); the official Node 24 macOS binary is 123 MB (measured). Tauri supports `titleBarStyle: "Overlay"` with `trafficLightPosition` ([Tauri config](https://v2.tauri.app/reference/config/)).
- Electrobun runs on Bun. Bun's `node:sqlite` reference page still says "not implemented", and the project's latest release is v2.0.5-beta.4.
- Neutralino's extensions call an installed `node`.
- A Swift WKWebView shell with [Sparkle](https://sparkle-project.org/documentation/) works but means writing and maintaining native code.

None of these lets us copy T3's code.
