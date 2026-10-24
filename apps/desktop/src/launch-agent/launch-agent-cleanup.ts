// Removes the launch agent that ran the board before the app, which the removed
// install-launch-agent.sh script installed. It stops the agent and deletes its
// plist; the checkout the plist ran from stays. With the plist gone, later launches
// find nothing to do.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

const LABEL = "nl.mux.factory-board";

export interface LaunchInput {
  readonly isPackaged: boolean;
  readonly home: string;
  /** The user's id, which names their GUI domain. */
  readonly uid: number;
  /** The launchctl to call; tests pass a fake. */
  readonly launchctl: string;
}

export const plistPath = (home: string) => NodePath.join(home, "Library/LaunchAgents", `${LABEL}.plist`);

/** Stops the agent, logging a failure: the plist goes either way. */
const bootout = (input: LaunchInput) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(input.launchctl, ["bootout", `gui/${input.uid}/${LABEL}`], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
    const exitCode = yield* child.exitCode;
    if (exitCode !== 0) yield* Effect.logWarning(`launchctl bootout ${LABEL} exited with code ${exitCode}`);
  }).pipe(
    Effect.scoped,
    Effect.catch((error) => Effect.logWarning(`could not run launchctl bootout ${LABEL}: ${String(error)}`)),
  );

/** In a packaged app, stops and deletes the old agent if it's there. Never fails. */
export const onLaunch = Effect.fn("LaunchAgentCleanup.onLaunch")(function* (input: LaunchInput) {
  const plist = plistPath(input.home);
  if (!input.isPackaged || !NodeFS.existsSync(plist)) return;
  yield* bootout(input);
  yield* Effect.try(() => NodeFS.rmSync(plist, { force: true })).pipe(
    Effect.andThen(Effect.logInfo(`removed the old launch agent ${LABEL}`)),
    Effect.catch((error) => Effect.logError(`could not delete ${plist}: ${String(error)}`)),
  );
});
