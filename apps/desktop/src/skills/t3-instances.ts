// Asks the T3 Code server on this machine for its provider instances, through packages/shared/src/install-targets.ts,
// running the `t3` CLI from the login shell's PATH. Nothing here logs the answer: an instance's environment and its
// HOME stay in the engine's Install targets.

import * as ChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import { discoverProviderInstances, type T3Run } from "@lar-factory/shared/install-targets";

import type { Discover } from "./skill-install.ts";

type Environment = Readonly<Record<string, string | undefined>>;

/** Runs `t3` with `env`, which names the PATH to find it on; a CLI that can't start exits with a null code. */
export const runT3 = (env: Environment): T3Run => (args, signal) =>
  new Promise((resolve) => {
    ChildProcess.execFile("t3", args, { env, signal, encoding: "utf8" }, (error, stdout) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout });
    });
  });

/** T3's runtime file: `T3_SERVER_RUNTIME`, or `server-runtime.json` in its userdata folder in `home`. */
export const runtimePath = (env: Environment, home: string) =>
  env.T3_SERVER_RUNTIME || NodePath.join(home, ".t3/userdata/server-runtime.json");

/** Asks the T3 that `home` runs, within discovery's own time limit, with `env` for the CLI. */
export const discover = (env: Environment, home: string): Discover => (installHome) =>
  Effect.promise(() => discoverProviderInstances({ home: installHome, runtimePath: runtimePath(env, home), runT3: runT3(env) }));
