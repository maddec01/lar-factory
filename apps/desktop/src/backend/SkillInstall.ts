// Installs the skills and checklists bundled in the app on launch, with the engine in
// packages/shared/src/install-skills.ts. A packaged app installs once per version; a dev run
// installs only when started with INSTALL_FLAG.

import * as NodePath from "node:path";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { InstallError, installSkills, type InstallResult } from "@mux-factory/shared/install-skills";

/** Starts a dev run's install. A packaged app ignores it and installs each new version. */
export const INSTALL_FLAG = "--install-skills";
/** Installs into this folder instead of the user's home, for dev runs and tests. */
export const ROOT_ENV = "MUX_FACTORY_INSTALL_ROOT";

export interface LaunchInput {
  readonly isPackaged: boolean;
  /** The app's version from its package.json. */
  readonly version: string;
  readonly home: string;
  /** The folder holding the bundled `skills/` and `references/`. */
  readonly bundle: string;
  readonly argv: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One call to the install engine. */
export interface Plan {
  readonly home: string;
  readonly bundle: string;
  readonly version: string;
  /** True for a dev run, whose version doesn't change when the skills do. */
  readonly force: boolean;
}

export class SkillInstallError extends Data.TaggedError("SkillInstallError")<{
  readonly message: string;
  /** False when the install stopped before it replaced any file. */
  readonly changed: boolean;
}> {}

/**
 * The bundle beside `appPath`, Electron's app path. Packaged, it sits in Resources/
 * outside app.asar, because Electron's fs can't copy a folder out of an asar.
 */
export const locateBundle = (appPath: string, isPackaged: boolean) =>
  isPackaged ? NodePath.resolve(appPath, "../bundle") : NodePath.resolve(appPath, "dist-electron/bundle");

/** The home the app installs into: the user's, or the folder ROOT_ENV names. */
export const installHome = (home: string, env: LaunchInput["env"]) => env[ROOT_ENV] || home;

/** What this launch installs, or undefined when it installs nothing. */
export const plan = (input: LaunchInput): Plan | undefined => {
  const force = !input.isPackaged;
  if (force && !input.argv.includes(INSTALL_FLAG)) return undefined;
  return { home: installHome(input.home, input.env), bundle: input.bundle, version: input.version, force };
};

/**
 * Runs this launch's install. A failed install doesn't write the manifest, so the next
 * launch tries again.
 */
export const onLaunch = Effect.fn("SkillInstall.onLaunch")(function* (input: LaunchInput) {
  const install = plan(input);
  if (!install) return undefined;
  return yield* Effect.try({
    try: () => installSkills(install.home, install.bundle, install.version, { force: install.force }),
    catch: (cause) =>
      new SkillInstallError({
        message: cause instanceof Error ? cause.message : String(cause),
        changed: cause instanceof InstallError ? cause.changed : true,
      }),
  });
});

/** A message box for the user. */
export interface Notice {
  readonly type: "warning" | "error";
  readonly message: string;
  readonly detail: string;
}

/** What to tell the user after an install: nothing, its conflicts or its error. */
export const notice = (outcome: InstallResult | SkillInstallError): Notice | undefined => {
  if (outcome instanceof SkillInstallError) {
    return {
      type: "error",
      message: "Mux Factory couldn't install its skills",
      detail: outcome.changed
        ? `${outcome.message}\n\nThe install stopped partway, so some skills may be the new version and some the old. The next launch tries again.`
        : `${outcome.message}\n\nThe previous skills are still in place. The next launch tries again.`,
    };
  }
  if (outcome.conflicts.length === 0) return undefined;
  return {
    type: "warning",
    message: "Mux Factory left some skills alone",
    detail: `These folders have a bundled skill's name but Mux Factory didn't install them, so it didn't overwrite them:\n\n${outcome.conflicts.join("\n")}`,
  };
};
