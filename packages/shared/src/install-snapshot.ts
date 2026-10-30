// What the board app tells its page about installing lar's skills: each Install target with its state, the provider
// instances that read it and the last check's Drift, Clashes and failures. Paths in the user's home read `~/…`. It
// carries no instance's environment, HOME value or provider configuration.

import type { SkillPaths, TargetSelection, TickResult, InstallSkillState, TargetProgress } from './install-skills.ts';
import type { InstallTargetKind, UnavailableReason } from './install-targets.ts';

/** What the app is doing with the skills: a check at launch, after T3 answers or before Start build, or the User's operation. */
export type InstallOperation = 'launch' | 'discovery' | 'build' | 'retry' | 'replace' | 'tick';

/** A provider instance as T3 names it, without its settings. */
export interface InstanceIdentity {
  id: string;
  driver: string;
  displayName: string;
  enabled: boolean;
}

/**
 * A bundled skill in one target: `installed` where lar owns it, `drift` where it no longer matches its Release,
 * `blocked` by a Clash, and `missing` where lar hasn't installed it.
 */
export type TargetSkillState = InstallSkillState | 'missing';

export interface TargetSnapshot {
  kind: InstallTargetKind;
  path: string;
  /** Every path that reaches this folder. */
  paths: string[];
  /** True when T3 requires it, or Claude targets link to it, so it can't be unticked. */
  locked: boolean;
  selection?: TargetSelection;
  /** False when installs leave it alone. */
  active: boolean;
  /** True for a selected Claude target left alone because its home folder doesn't exist, which the app never creates. */
  homeMissing?: true;
  /** The Release installed there. */
  release?: string;
  /** True once every bundled skill installed successfully there, with no Clash or failure. */
  finished: boolean;
  /** The ids of the provider instances that read it. */
  instances: string[];
  skills: { name: string; state: TargetSkillState }[];
  /** Actual work in this launch, retained after the operation finishes. Checks never imply a reinstall. */
  operation?: TargetProgress['operation'];
  running?: boolean;
  /** Drift successfully replaced in this target during this app launch. */
  replaced?: string[];
  /** Why the last check failed there. */
  error?: string;
}

/** How the install overview closed in this app launch. */
export type InstallOverviewClosure = 'automatic' | 'dismissed';

export interface InstallSnapshot {
  /** Presentation only, retained by the desktop process until the app quits. */
  overview?: 'open' | InstallOverviewClosure;
  /** Monotonic within one app launch, so a delayed read or command cannot overwrite a newer push. */
  revision?: number;
  /** False when this run installs nothing, a dev run without `--install-skills`; every operation is then refused. */
  installs: boolean;
  /** False until the app first installs its skills. */
  installed: boolean;
  /** The app's Release. */
  version: string;
  running: InstallOperation | null;
  /** Whether T3 listed its instances: `waiting` until it answers, else why it couldn't. */
  discovery: 'waiting' | 'available' | UnavailableReason;
  instances: InstanceIdentity[];
  targets: TargetSnapshot[];
  /** The last check's Drift, left in place. */
  drift: SkillPaths[];
  /** The skills whose Drift this app launch overwrote in any target. */
  replaced: string[];
  /** The last check's Clashes. */
  conflicts: string[];
  blocked: SkillPaths[];
  /** Why the last check, or reading the targets, failed. */
  error?: string;
}

/** The snapshot after an operation, with why it was refused or failed, and for a tick what it left alone and removed. */
export interface InstallOperationResult {
  snapshot: InstallSnapshot;
  error?: string;
  conflicts?: string[];
  removed?: TickResult['removed'];
}

/** Targets shown in the overview, including retained work and unavailable selected homes. */
export const installOverviewTargets = (snapshot: InstallSnapshot): TargetSnapshot[] =>
  snapshot.targets.filter(({ active, homeMissing, operation, error }) => active || homeMissing || operation === 'install' || operation === 'replace' || error);

/** Every current target succeeded, with no running operation, global error or Clash. */
export const installOverviewSucceeded = (snapshot: InstallSnapshot): boolean => {
  const targets = installOverviewTargets(snapshot);
  return !snapshot.running && !snapshot.error && !snapshot.blocked.length && !snapshot.conflicts.length && targets.length > 0
    && targets.every(({ finished, homeMissing, running, error, skills }) => finished && !homeMissing && !running && !error
      && skills.every(({ state }) => state === 'installed'));
};
