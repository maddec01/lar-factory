// What the board app tells its page about installing lar's skills: each Install target with its state, the provider
// instances that read it and the last check's Drift, Clashes and failures. Paths in the user's home read `~/…`. It
// carries no instance's environment, HOME value or provider configuration.

import type { SkillPaths, TargetSelection, TickResult } from './install-skills.ts';
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
export type TargetSkillState = 'installed' | 'drift' | 'blocked' | 'missing';

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
  /** True once an install of `release` there finished. */
  finished: boolean;
  /** The ids of the provider instances that read it. */
  instances: string[];
  skills: { name: string; state: TargetSkillState }[];
  /** Why the last check failed there. */
  error?: string;
}

export interface InstallSnapshot {
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
  /** The skills whose Drift the last check overwrote. */
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
