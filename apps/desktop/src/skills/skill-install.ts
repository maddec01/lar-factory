// Installs the skills bundled in the app, with the engine in packages/shared/src/install-skills.ts. A packaged app
// checks them at launch and before each Start build: it installs a new Release and reports Drift, which it leaves as
// it is unless the User chooses Replace, or Replace and start before a build. A dev run does so only with INSTALL_FLAG.
// The launch installs into fallback targets after the board page finishes loading, then into the targets of T3's
// provider instances once T3 answers. T3 can't unselect those. The
// board's page can retry, replace Drift and tick a target. The main process runs every check and operation one at a
// time, and keeps what they found for the page.

import * as NodePath from "node:path";

import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import {
  blockedBy, listed, type DriftChoice, type InstallOperation, type InstallSnapshot, type SkillCheckOutcome,
} from "@lar-factory/shared";
import {
  InstallError, profileTargets, setTargetTick, t3Targets, type InstallResult, type OfferedTarget, type TickResult, type TargetProgress,
} from "@lar-factory/shared/install-skills";
import type { InstanceDiscovery, ProviderInstance } from "@lar-factory/shared/install-targets";

import { runInstall } from "./install-runner.ts";

/** How long the launch waits before it asks a T3 that didn't answer again. */
const REDISCOVER_EVERY = "30 seconds";

/** Starts a dev run's install. A packaged app ignores it and installs on every launch. */
export const INSTALL_FLAG = "--install-skills";
/** Installs into this folder instead of the user's home, for dev runs and tests, and never writes outside it. */
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
  /** The folder ROOT_ENV names, which every write must stay in. */
  readonly root?: string;
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

/** The folder ROOT_ENV names, or undefined when it is unset or empty. */
const installRoot = (env: LaunchInput["env"]) => env[ROOT_ENV] || undefined;

/** The home the app installs into: the user's, or the folder ROOT_ENV names. */
export const installHome = (home: string, env: LaunchInput["env"]) => installRoot(env) ?? home;

/** What this launch installs, or undefined when it installs nothing. */
export const plan = (input: LaunchInput): Plan | undefined => {
  if (!input.isPackaged && !input.argv.includes(INSTALL_FLAG)) return undefined;
  const root = installRoot(input.env);
  return { home: root ?? input.home, ...root && { root }, bundle: input.bundle, version: input.version };
};

/** One check of the installed skills against the bundle, which installs a new Release and reports Drift. */
type Check = Effect.Effect<InstallResult, SkillInstallError>;

/**
 * Asks T3 for its provider instances, resolving `~` to `home`. It never fails: within its time limit it answers that
 * T3 is unavailable instead.
 */
export type Discover = (home: string) => Effect.Effect<InstanceDiscovery>;

/** The targets the app installs into whether or not T3 answers: ~/.agents/skills and the default Claude home. */
const fallbackTargets = (home: string): Array<OfferedTarget> => [
  { kind: "agents", path: NodePath.join(home, ".agents/skills") },
  { kind: "claude", path: NodePath.join(home, ".claude/skills") },
];

/**
 * The targets a check offers before T3 answers: the fallback ones, and those the manifest records T3 required, still
 * required, so a restart while T3 is down keeps installing there. Just the fallback ones when the manifest can't be
 * read; the check then reports why.
 */
export const offlineTargets = (home: string): Array<OfferedTarget> => {
  try {
    return [...fallbackTargets(home), ...t3Targets(home)];
  } catch {
    return fallbackTargets(home);
  }
};

/** Every Install target of T3's instances, disabled ones too, once per path and required, so no untick turns it off. */
export const requiredTargets = (instances: ReadonlyArray<ProviderInstance>): Array<OfferedTarget> => {
  const byPath = new Map<string, OfferedTarget>();
  for (const target of instances.flatMap(({ targets }) => targets)) {
    if (!byPath.has(target.path)) byPath.set(target.path, { ...target, required: true });
  }
  return [...byPath.values()];
};

/** A lock that makes the checks it wraps run one at a time: one that starts while another runs waits for it to finish. */
export const oneAtATime = Semaphore.make(1).pipe(Effect.map((semaphore) => semaphore.withPermits(1)));

/** What this launch's checks know, for the board's page. It holds T3's instances, never their settings. */
export interface CheckState {
  readonly revision?: number;
  readonly progress?: ReadonlyArray<TargetProgress>;
  readonly running: InstallOperation | null;
  readonly discovery: InstallSnapshot["discovery"];
  /** T3's instances as it last listed them this run. */
  readonly instances: ReadonlyArray<ProviderInstance>;
  /** The targets each check offers: the fallback ones and those of T3's instances, or before T3 answers those it last required. */
  readonly targets: ReadonlyArray<OfferedTarget>;
  /** Last completed check, retained when a later operation fails before it can check Drift or Clashes. */
  readonly lastResult?: InstallResult;
  /** The last check's outcome, or none before the first. */
  readonly outcome?: InstallResult | SkillInstallError;
}

/** This launch's checks and the board page's operations, which take turns. */
export interface Checks {
  /** The launch's check, into the fallback targets without waiting for T3. */
  readonly atLaunch: Check;
  /** Asks T3, then checks the targets it reports as `atLaunch` does; undefined when T3 doesn't answer. */
  readonly afterDiscovery: Effect.Effect<InstallResult | undefined, SkillInstallError>;
  /**
   * The check before each Start build, after asking T3 again. With the User's Drift choice it reuses the answer T3
   * gave the check that asked about Drift, so the build waits for T3 once; with `replace` it overwrites the Drift of
   * every active target first, as Replace does.
   */
  readonly beforeBuild: (drift?: DriftChoice) => Check;
  /** The User's retry: always asks T3 again, then checks, which tries each failed target again. */
  readonly retry: Check;
  /** The User's Replace: reuses T3's last answer, or asks again if T3 didn't give one, then overwrites the Drift of every active target with this Release. */
  readonly replace: Check;
  /**
   * Ticks or unticks the target at `path`, then checks, which installs into a newly ticked target. A refused tick
   * fails before any write and leaves the last outcome as it was.
   */
  readonly tick: (path: string, ticked: boolean) => Effect.Effect<TickResult, SkillInstallError>;
  readonly state: () => CheckState;
  /** Calls `listener` after each change to `state`; the returned function stops it. */
  readonly subscribe: (listener: () => void) => () => void;
}

const failure = (cause: unknown, changed: boolean) =>
  new SkillInstallError({ message: cause instanceof Error ? cause.message : String(cause), changed });

/**
 * This launch's checks, which install a new Release and report Drift, one run at a time; undefined when the launch
 * checks nothing. Each installs into the fallback targets and the ones T3 last reported, which an outage later in the
 * run keeps. The engine installs only into a target whose Release differs, so a new target leaves the others as they
 * are. A failed check doesn't write the manifest, so the next one tries again.
 */
export const makeChecks = (input: LaunchInput, discover: Discover, run: typeof runInstall = runInstall): Effect.Effect<Checks | undefined> => {
  const install = plan(input);
  if (!install) return Effect.succeed(undefined);
  return oneAtATime.pipe(Effect.map((serial): Checks => {
    const listeners = new Set<() => void>();
    let state: CheckState = { running: null, discovery: "waiting", instances: [], targets: offlineTargets(install.home) };
    const update = (next: Partial<CheckState>) => {
      state = { ...state, ...next, revision: (state.revision ?? 0) + 1 };
      for (const listener of listeners) listener();
    };
    const learn = discover(install.home).pipe(Effect.map((answer) => {
      if (answer.available) {
        update({
          discovery: "available", instances: answer.instances,
          targets: [...fallbackTargets(install.home), ...requiredTargets(answer.instances)],
        });
      } else update({ discovery: answer.reason });
      return answer.available;
    }));
    /**
     * T3's last answer when it gave one, or a new one: a T3 that didn't answer may have started since. Replace and the
     * check after the User's Drift choice reuse the last available answer however old it is, on purpose: they act on
     * the targets the User was shown. Retry and Start build always ask T3 again.
     */
    const reuse = Effect.suspend(() => state.discovery === "available" ? Effect.succeed(true) : learn);
    const progressed = (event: TargetProgress) => {
      const earlier = state.progress ?? [];
      const previous = earlier.find(({ target }) => target.paths.some((path) => event.target.paths.includes(path)));
      const retained = event.operation === "check" && previous?.operation !== undefined && previous.operation !== "check";
      const next = {
        ...event,
        // A later discovery check must not erase actual work or make it look like another installation.
        ...retained && { operation: previous.operation, running: false },
        // A read-only check keeps earlier results while it verifies them. Actual writes report installing again.
        skills: event.skills.map((skill) => event.operation === "check" && ["pending", "checking"].includes(skill.state)
          ? previous?.skills.find(({ name }) => name === skill.name) ?? skill : skill),
        target: event.running && previous?.target.error ? { ...event.target, error: previous.target.error } : event.target,
        replaced: [...new Set([...(previous?.replaced ?? []), ...event.replaced])].sort(),
      };
      update({ progress: [...earlier.filter((entry) => entry !== previous), next] });
    };
    const settle = (outcome: InstallResult | SkillInstallError) => Effect.sync(() => {
      if (!(outcome instanceof SkillInstallError)) {
        // A failed copy cannot establish that earlier Drift resolved. Keep only the failed paths whose skill did
        // not finish, so a partial Replace can clear the skills it did replace while the others stay actionable.
        const drift = new Map(outcome.drift.map(({ skill, paths }) => [skill, [...paths]]));
        for (const { skill, paths } of state.lastResult?.drift ?? []) {
          for (const at of paths) {
            const failed = outcome.targets.find((target) => target.error && target.paths.some((folder) => at.path === NodePath.join(folder, skill)));
            const installed = state.progress?.some((event) => failed?.paths.some((path) => event.target.paths.includes(path))
              && event.skills.some(({ name, state }) => name === skill && state === "installed"));
            if (!failed || installed) continue;
            const known = drift.get(skill) ?? [];
            if (!known.some(({ path }) => path === at.path)) drift.set(skill, [...known, at]);
          }
        }
        outcome = { ...outcome, drift: [...drift].map(([skill, paths]) => ({ skill, paths })) };
      }
      const failed = outcome instanceof SkillInstallError ? outcome : undefined;
      update({
        running: null, outcome,
        ...!(outcome instanceof SkillInstallError) && { lastResult: outcome },
        ...failed && { progress: state.progress?.map((event) => event.running ? {
          ...event, running: false, target: { ...event.target, error: { message: failed.message, changed: failed.changed } },
          skills: event.skills.map((skill) => ["pending", "checking", "installing"].includes(skill.state) ? { ...skill, state: "failed" as const } : skill),
        } : event) ?? [] },
      });
    });
    // One check, run inside a turn the caller holds.
    const checkNow = (operation: InstallOperation, options: { recordWarning: boolean; replace?: boolean }): Check =>
      Effect.suspend(() => {
        update({ running: operation });
        return Effect.tryPromise({
          try: () => run({ ...install, options: { ...options, root: install.root, targets: [...state.targets] } }, progressed),
          catch: (cause) => failure(cause, cause instanceof InstallError ? cause.changed : true),
        }).pipe(Effect.uninterruptible, Effect.tap(settle), Effect.tapError(settle));
      });
    const check = (operation: InstallOperation, options: { recordWarning: boolean; replace?: boolean }) => serial(checkNow(operation, options));
    return {
      atLaunch: check("launch", { recordWarning: true }),
      afterDiscovery: learn.pipe(Effect.flatMap((available) => available ? check("discovery", { recordWarning: true }) : Effect.succeed(undefined))),
      beforeBuild: (drift) => (drift ? reuse : learn).pipe(Effect.andThen(check("build", { recordWarning: false, replace: drift === "replace" }))),
      retry: learn.pipe(Effect.andThen(check("retry", { recordWarning: true }))),
      replace: reuse.pipe(Effect.andThen(check("replace", { recordWarning: true, replace: true }))),
      tick: (path, ticked) => serial(Effect.suspend(() => {
        update({ running: "tick" });
        return Effect.try({
          try: () => setTargetTick(install.home, path, ticked, { root: install.root, targets: [...state.targets], known: profileTargets(install.home) }),
          catch: (cause) => failure(cause, false),
        }).pipe(
          Effect.tapError(() => Effect.sync(() => update({ running: null }))),
          Effect.flatMap((result) => {
            if (!ticked) update({ progress: (state.progress ?? []).filter(({ target }) => !target.paths.includes(path)) });
            return checkNow("tick", { recordWarning: false }).pipe(Effect.as(result));
          }),
        );
      })),
      state: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }));
};

/**
 * Asks T3 through `afterDiscovery` until it answers, waiting `every` after each time it doesn't, so a T3 that was slow
 * or not yet running at launch still gets its targets installed later in the run. Each check takes its turn with the
 * others, and installs only the targets new to it. A check that fails counts as an answer: the board page reports it.
 */
export const discoverUntilAnswered = (checks: Checks, every: Duration.Input): Effect.Effect<void> => {
  const ask: Effect.Effect<void> = checks.afterDiscovery.pipe(
    Effect.match({ onFailure: () => true, onSuccess: (outcome) => outcome !== undefined }),
    Effect.flatMap((answered) => answered ? Effect.void : Effect.sleep(every).pipe(Effect.andThen(Effect.suspend(() => ask)))),
  );
  return ask;
};

/** Each Install target the check failed in, as `<path>: <reason>`. */
const failures = (outcome: InstallResult) =>
  outcome.targets.flatMap(({ path, error }) => error ? [`${path}: ${error.message}`] : []);

/**
 * Why Start build can't run after a check: a failed install or replacement, in any target, or a Clash, a path the app
 * didn't install that blocks a skill. Drift alone doesn't stop it here; buildAnswer asks the User about it.
 */
export const buildRefusal = (outcome: InstallResult | SkillInstallError, drift?: DriftChoice): string | null => {
  const couldnt = drift === "replace" ? "couldn't replace its changed skills" : "couldn't install its skills";
  if (outcome instanceof SkillInstallError) return `Lar Factory ${couldnt}, so the build can't start: ${outcome.message}`;
  const failed = failures(outcome);
  if (failed.length > 0) return `Lar Factory ${couldnt}, so the build can't start. ${failed.join(" ")}`;
  if (outcome.blocked.length === 0) return null;
  const skills = outcome.blocked.map(({ skill, paths }) => `${skill} is ${blockedBy(paths).join("")}.`);
  const one = outcome.blocked.length === 1 && outcome.blocked[0]!.paths.length === 1;
  return `The build can't start while a skill is blocked. ${skills.join(" ")} Move ${one ? "that path" : "each path"} away, then start the build again.`;
};

/**
 * What the check before a Start build tells the board server, given the User's Drift choice. A failure or a Clash
 * refuses the build. Drift asks for a choice until the User makes one: Start anyway (`keep`) starts with the skills
 * as they are, and Drift left after Replace and start refuses it.
 */
export const buildAnswer = (outcome: InstallResult | SkillInstallError, drift?: DriftChoice): SkillCheckOutcome => {
  const refusal = buildRefusal(outcome, drift);
  if (refusal || outcome instanceof SkillInstallError || outcome.drift.length === 0 || drift === "keep") return { refusal };
  const skills = outcome.drift.map(({ skill }) => skill);
  if (drift === "replace") {
    return { refusal: `Lar Factory couldn't replace ${listed(skills)}, so the build can't start. They still differ from Release ${outcome.version}.` };
  }
  return {
    refusal: `${listed(skills)} changed since Lar Factory installed ${skills.length > 1 ? "them" : "it"}. Replace and start, or start anyway.`,
    drift: skills,
  };
};

/** One app-scoped launch lifecycle. Only the board page's readiness signal releases installation and discovery. */
export const launchWhenReady = (checks: Checks) => Effect.gen(function* () {
  const ready = yield* Deferred.make<void>();
  yield* Deferred.await(ready).pipe(
    Effect.andThen(checks.atLaunch.pipe(Effect.ignore)),
    Effect.andThen(discoverUntilAnswered(checks, REDISCOVER_EVERY)),
    Effect.forkScoped,
  );
  return () => { Effect.runSync(Deferred.succeed(ready, undefined)); };
});
