// Installs the launcher that puts the bundled lar-work command on the user's PATH, so shaping and build threads run
// it from any repository or worktree while the app is closed. The launcher runs the bundle with the app's own Node
// (ELECTRON_RUN_AS_NODE=1, as BoardServer runs the server), so it needs no system Node.
//
// It goes in ~/.local/bin/lar-work: a folder in the user's home, so the app writes it without an admin prompt, and
// the one Claude Code installs its own command into, so threads usually have it on their PATH already. /usr/local/bin
// needs an admin on Apple Silicon Macs, and /opt/homebrew/bin belongs to Homebrew.
//
// A packaged app rewrites the launcher on each launch where it no longer names this app, so it follows the app after
// it moves or updates. A file at that path without the launcher's mark is not the app's: it stays, and the launch logs it.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

/** The launcher's second line, which tells a launcher the app wrote from a file it didn't. */
const MARK = "# Installed by the Lar Factory app, which rewrites this file on launch.";

export const launcherPath = (home: string) => NodePath.join(home, ".local/bin/lar-work");

/**
 * The bundled command beside `appPath`, Electron's app path: in Resources/ outside app.asar when packaged, because the
 * app's Node can't run a file inside an asar; in dist-electron/ after `vp pack` otherwise.
 */
export const locateCommand = (appPath: string, isPackaged: boolean) =>
  isPackaged
    ? NodePath.resolve(appPath, "../work-records/lar-work.mjs")
    : NodePath.resolve(appPath, "dist-electron/work-records/lar-work.mjs");

export interface InstallInput {
  readonly home: string;
  /** The app's binary, which runs the command in Node mode. */
  readonly executablePath: string;
  readonly commandFile: string;
}

/** "installed" wrote the launcher, "unchanged" found it current, "foreign" found a file the app didn't install. */
export interface InstallOutcome {
  readonly kind: "installed" | "unchanged" | "foreign";
  readonly path: string;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const launcherScript = (input: InstallInput) =>
  [
    "#!/bin/sh",
    MARK,
    `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(input.executablePath)} --disable-warning=ExperimentalWarning ${shellQuote(input.commandFile)} "$@"`,
    "",
  ].join("\n");

/** What sits at `path`: nothing, the app's launcher with its text, or something else, which includes a symlink. */
const existing = (path: string): { kind: "none" } | { kind: "ours"; text: string } | { kind: "foreign" } => {
  const stat = NodeFS.lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { kind: "none" };
  if (!stat.isFile()) return { kind: "foreign" };
  const text = NodeFS.readFileSync(path, "utf8");
  return text.split("\n")[1] === MARK ? { kind: "ours", text } : { kind: "foreign" };
};

/** Writes the launcher unless it is current or a file the app didn't install holds its path. Throws on a failed write. */
export const install = (input: InstallInput): InstallOutcome => {
  const path = launcherPath(input.home);
  const script = launcherScript(input);
  const found = existing(path);
  if (found.kind === "foreign") return { kind: "foreign", path };
  if (found.kind === "ours" && found.text === script) return { kind: "unchanged", path };
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  // Written beside the launcher and renamed over it, so a thread never runs half a file.
  const temp = `${path}.${process.pid}.tmp`;
  try {
    NodeFS.writeFileSync(temp, script, { mode: 0o755 });
    NodeFS.renameSync(temp, path);
  } finally {
    NodeFS.rmSync(temp, { force: true });
  }
  return { kind: "installed", path };
};

/** In a packaged app, installs the launcher and logs what it found. Never fails. */
export const onLaunch = Effect.fn("LarWorkLauncher.onLaunch")(function* (
  input: InstallInput & { readonly isPackaged: boolean },
) {
  if (!input.isPackaged) return;
  yield* Effect.try(() => install(input)).pipe(
    Effect.flatMap((outcome) => {
      switch (outcome.kind) {
        case "installed":
          return Effect.logInfo(`installed the lar-work launcher at ${outcome.path}`);
        case "unchanged":
          return Effect.void;
        case "foreign":
          return Effect.logWarning(`left ${outcome.path} alone: the app didn't install it, so lar-work isn't installed`);
      }
    }),
    Effect.catch((error) => Effect.logError(`could not install the lar-work launcher: ${String(error)}`)),
  );
});
