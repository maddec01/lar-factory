// What the board's page sees of the skill install and the operations it can ask for: the install snapshot, built from
// the launch's checks and the manifest, a retry, Replace of Drift and a target's tick. The page is untrusted input,
// so a call must come from the board's page and a tick must name a listed target and be a boolean. The snapshot
// writes paths in the home from `~` and holds no instance's settings.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import type { InstallOperationResult, InstallSnapshot, TargetSkillState, TargetSnapshot } from "@lar-factory/shared";
import { describeTargets, profileTargets, type InstallResult, type SkillPaths } from "@lar-factory/shared/install-skills";

import { offlineTargets, SkillInstallError, type Checks, type CheckState } from "./skill-install.ts";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** `text` with each path in `home` written from `~`, as the page shows paths. */
const inHome = (text: string, home: string) => {
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?=$|[/\\s:'",;)])`, "g"), "~");
};

/** True when `url`, the calling frame's address, is on the board's origin. */
export const fromBoard = (url: string | undefined, boardOrigin: string): boolean => {
  if (!url || !boardOrigin) return false;
  try {
    return new URL(url).origin === boardOrigin;
  } catch {
    return false;
  }
};

export interface BoardInput {
  /** The home the app installs into. */
  readonly home: string;
  readonly version: string;
  /** The folder holding the bundled `skills/`. */
  readonly bundle: string;
}

/** The bundle's skill names, or none when it can't be read. */
const bundledSkills = (bundle: string) => {
  try {
    return NodeFS.readdirSync(NodePath.join(bundle, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
};

/** The state of a run that installs nothing: the targets offered before T3 answers, and no check. */
const readOnlyState = (home: string): CheckState =>
  ({ running: null, discovery: "waiting", instances: [], targets: offlineTargets(home) });

/** The page's snapshot, and each target it shows with its real path, which the snapshot writes from `~`. */
interface Described {
  readonly snapshot: InstallSnapshot;
  readonly targets: ReadonlyArray<{ readonly real: string; readonly shown: TargetSnapshot }>;
}

/**
 * The page's snapshot of `state`: the targets as the manifest records them, each with the instances that read it and
 * each bundled skill's state there from the last check.
 */
const describe = (input: BoardInput, state: CheckState, installs: boolean): Described => {
  const { home } = input;
  const tilde = (path: string) => inHome(path, home);
  const outcome: InstallResult | undefined = state.outcome instanceof SkillInstallError ? undefined : state.outcome;
  const shownPaths = (list: ReadonlyArray<SkillPaths>) =>
    list.map(({ skill, paths }) => ({ skill, paths: paths.map((at) => ({ ...at, path: tilde(at.path) })) }));
  const at = (list: ReadonlyArray<SkillPaths>, skill: string, folders: ReadonlyArray<string>) =>
    list.some((found) => found.skill === skill && found.paths.some(({ path }) => folders.some((folder) => path === NodePath.join(folder, skill))));
  const bundled = bundledSkills(input.bundle);
  let error = state.outcome instanceof SkillInstallError ? state.outcome.message : undefined;
  let described: Described["targets"] = [];
  try {
    described = describeTargets(home, [...state.targets], profileTargets(home)).map((target) => {
      const checked = outcome?.targets.find(({ paths }) => paths.some((path) => target.paths.includes(path)));
      const skillState = (skill: string): TargetSkillState =>
        outcome && at(outcome.blocked, skill, target.paths) ? "blocked"
        : outcome && at(outcome.drift, skill, target.paths) ? "drift"
        : target.skills.includes(skill) ? "installed" : "missing";
      const shown: TargetSnapshot = {
        kind: target.kind,
        path: tilde(target.path),
        paths: target.paths.map(tilde),
        locked: target.required || target.path === NodePath.join(home, ".agents/skills"),
        ...target.selection && { selection: target.selection },
        active: target.active,
        ...target.homeMissing && { homeMissing: true },
        ...target.release !== undefined && { release: target.release },
        finished: target.finished,
        instances: state.instances.filter(({ targets: read }) => read.some(({ path }) => target.paths.includes(path))).map(({ id }) => id),
        skills: bundled.map((name) => ({ name, state: skillState(name) })),
        ...checked?.error && { error: tilde(checked.error.message) },
      };
      return { real: target.path, shown };
    });
  } catch (cause) {
    error = message(cause);
  }
  const targets = described.map(({ shown }) => shown);
  const snapshot: InstallSnapshot = {
    installs,
    installed: targets.some(({ release }) => release !== undefined),
    version: input.version,
    running: state.running,
    discovery: state.discovery,
    instances: state.instances.map(({ id, driver, displayName, enabled }) => ({ id, driver, displayName, enabled })),
    targets,
    drift: shownPaths(outcome?.drift ?? []),
    replaced: outcome?.replaced ?? [],
    conflicts: (outcome?.conflicts ?? []).map(tilde),
    blocked: shownPaths(outcome?.blocked ?? []),
    ...error !== undefined && { error: tilde(error) },
  };
  return { snapshot, targets: described };
};

/** The install as the board's page uses it. */
export interface InstallBoard {
  readonly snapshot: () => InstallSnapshot;
  /** Calls `listener` with each new snapshot; the returned function stops it. */
  readonly subscribe: (listener: (snapshot: InstallSnapshot) => void) => () => void;
  readonly retry: () => Promise<InstallOperationResult>;
  readonly replace: () => Promise<InstallOperationResult>;
  /** Ticks or unticks the target the snapshot shows at `path`; anything else is refused. */
  readonly setTick: (path: unknown, ticked: unknown) => Promise<InstallOperationResult>;
}

const NOT_INSTALLING = `This run of Lar Factory doesn't install skills. Start it with --install-skills to change them.`;

/**
 * The board's view of `checks`, or of the manifest alone when this run installs nothing; then every operation is
 * refused. A refused or failed operation answers with its reason and the snapshot as it is.
 */
export const makeInstallBoard = (input: BoardInput, checks: Checks | undefined): InstallBoard => {
  const look = () => describe(input, checks?.state() ?? readOnlyState(input.home), checks !== undefined);
  const read = () => look().snapshot;
  const answer = <A>(operation: Effect.Effect<A, SkillInstallError>, extra: (result: A) => Partial<InstallOperationResult> = () => ({})) =>
    Effect.runPromise(operation.pipe(Effect.match({
      onFailure: (failed): InstallOperationResult => ({ snapshot: read(), error: inHome(failed.message, input.home) }),
      onSuccess: (result): InstallOperationResult => ({ snapshot: read(), ...extra(result) }),
    })));
  const refuse = (error: string) => Promise.resolve<InstallOperationResult>({ snapshot: read(), error });
  return {
    snapshot: read,
    subscribe: (listener) => checks?.subscribe(() => listener(read())) ?? (() => {}),
    retry: () => (checks ? answer(checks.retry) : refuse(NOT_INSTALLING)),
    replace: () => (checks ? answer(checks.replace) : refuse(NOT_INSTALLING)),
    setTick: (path, ticked) => {
      if (!checks) return refuse(NOT_INSTALLING);
      if (typeof ticked !== "boolean") return refuse("A tick must be true or false");
      const target = look().targets.find(({ shown }) => shown.path === path);
      if (typeof path !== "string" || !target) return refuse(`${String(path)} is not an Install target`);
      if (!ticked && target.shown.locked) return refuse(`${path} stays ticked: T3 Code's provider instances or Claude's skill links read it`);
      return answer(checks.tick(target.real, ticked), ({ conflicts, removed }) => ({ conflicts: conflicts.map((at) => inHome(at, input.home)), removed }));
    },
  };
};
