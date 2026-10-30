// Installs the skills bundled in the app, with the engine in packages/shared/src/install-skills.ts. A packaged app
// checks them at launch and before each Start build: it installs a new Release and reports Drift, which it leaves as
// it is. A dev run does so only when started with INSTALL_FLAG. The main process runs every check one at a time.

import * as NodePath from "node:path";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import { blockedBy } from "@lar-factory/shared";
import { InstallError, installSkills, type InstallResult } from "@lar-factory/shared/install-skills";

/** Starts a dev run's install. A packaged app ignores it and installs on every launch. */
export const INSTALL_FLAG = "--install-skills";
/** Installs into this folder instead of the user's home, for dev runs and tests. */
export const ROOT_ENV = "LAR_FACTORY_INSTALL_ROOT";

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
  if (!input.isPackaged && !input.argv.includes(INSTALL_FLAG)) return undefined;
  return { home: installHome(input.home, input.env), bundle: input.bundle, version: input.version };
};

/** One check of the installed skills against the bundle, which installs a new Release and reports Drift. */
export type Check = Effect.Effect<InstallResult, SkillInstallError>;

/** A lock that makes the checks it wraps run one at a time: one that starts while another runs waits for it to finish. */
export const oneAtATime = Semaphore.make(1).pipe(Effect.map((semaphore) => semaphore.withPermits(1)));

/** This launch's two checks, which take turns. */
export interface Checks {
  /** The launch's check, which records that it reported its conflicts, so their dialog shows once per Release. */
  readonly atLaunch: Check;
  /** The check before each Start build, which leaves that dialog to the launch. */
  readonly beforeBuild: Check;
}

/**
 * This launch's checks, which install a new Release and report Drift, one run at a time; undefined when the launch
 * checks nothing. A failed check doesn't write the manifest, so the next one tries again.
 */
export const makeChecks = (input: LaunchInput): Effect.Effect<Checks | undefined> => {
  const install = plan(input);
  if (!install) return Effect.succeed(undefined);
  const check = (recordWarning: boolean): Check => Effect.try({
    try: () => installSkills(install.home, install.bundle, install.version, { recordWarning }),
    catch: (cause) =>
      new SkillInstallError({
        message: cause instanceof Error ? cause.message : String(cause),
        changed: cause instanceof InstallError ? cause.changed : true,
      }),
  });
  return oneAtATime.pipe(Effect.map((serial) => ({ atLaunch: serial(check(true)), beforeBuild: serial(check(false)) })));
};

/**
 * Why Start build can't run after a check: a failed install, or a Clash, a path the app didn't install that blocks a
 * skill. Drift doesn't stop it: the build runs with the skills as they are.
 */
export const buildRefusal = (outcome: InstallResult | SkillInstallError): string | null => {
  if (outcome instanceof SkillInstallError) {
    return `Lar Factory couldn't install its skills, so the build can't start: ${outcome.message}`;
  }
  if (outcome.blocked.length === 0) return null;
  const skills = outcome.blocked.map(({ skill, paths }) => `${skill} is ${blockedBy(paths).join("")}.`);
  const one = outcome.blocked.length === 1 && outcome.blocked[0]!.paths.length === 1;
  return `The build can't start while a skill is blocked. ${skills.join(" ")} Move ${one ? "that path" : "each path"} away, then start the build again.`;
};

/** A message box for the user. */
export interface Notice {
  readonly type: "warning" | "error";
  readonly message: string;
  readonly detail: string;
}

/**
 * What to tell the user after an install: nothing, its error, or a warning that names its Clashes, on the first launch
 * of a version, and its Drift, on every launch.
 */
export const notice = (outcome: InstallResult | SkillInstallError): Notice | undefined => {
  if (outcome instanceof SkillInstallError) {
    return {
      type: "error",
      message: "Lar Factory couldn't install its skills",
      detail: outcome.changed
        ? `${outcome.message}\n\nThe install stopped partway, so some skills may be the new version and some the old. The next Start build or launch tries again.`
        : `${outcome.message}\n\nThe previous skills are still in place. The next Start build or launch tries again.`,
    };
  }
  const parts = [
    ...outcome.warn
      ? [`These folders have a bundled skill's name but Lar Factory didn't install them, so it didn't overwrite them:\n\n${outcome.conflicts.join("\n")}`]
      : [],
    ...outcome.drift.length > 0
      ? [`These skills changed since Lar Factory installed them, and it left them as they are:\n\n${
        outcome.drift.map(({ skill, paths }) => `${skill}: ${paths.map(({ path }) => path).join(", ")}`).join("\n")}`]
      : [],
  ];
  if (parts.length === 0) return undefined;
  return {
    type: "warning",
    message: outcome.warn ? "Lar Factory left some skills alone" : "Some of Lar Factory's skills changed",
    detail: parts.join("\n\n"),
  };
};
