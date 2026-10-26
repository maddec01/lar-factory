// Opens the built app in Electron, as T3 Code's apps/desktop/scripts/start-electron.mjs.
// It first fetches Electron's binary if the install skipped it (pnpm runs no
// install scripts for electron).
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const appDir = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const electronPath = ensureElectronRuntime();

// Electron run from a shell that has ELECTRON_RUN_AS_NODE set would start as plain Node.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

// Arguments pass through, so `pnpm run dev --install-skills` reaches the app.
const child = NodeChildProcess.spawn(electronPath, [".", ...process.argv.slice(2)], { stdio: "inherit", cwd: appDir, env: childEnv });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
