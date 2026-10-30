// Installs a bundle's skills into a list of Install targets when their Release changes: copies into
// ~/.agents/skills and Antigravity's folders, and links from each Claude home's skills/ into ~/.agents/skills.
// Between Releases it only reports Drift, unless the User chooses Replace. One manifest in ~/.agents records, per
// target, the skills lar owns there, the Release installed there and whether that install finished.

import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { InstallTarget, InstallTargetKind } from './install-targets.ts';
import { isRecord } from './is-record.ts';

/** The manifest's file name in ~/.agents. The skills CLI owns .skill-lock.json, so this never touches it. */
export const INSTALL_MANIFEST = '.lar-factory-install.json';

/**
 * Antigravity's skill folders, relative to the home: the app's and the CLI's. Antigravity reads neither
 * ~/.agents/skills nor Claude's folders, so each gets a copy of every skill. Copies, not links: T3 shows Antigravity
 * follows a linked skills folder, but nothing shows it follows a link per skill inside one.
 */
const ANTIGRAVITY_FOLDERS = ['.gemini/config/skills', '.gemini/antigravity-cli/skills'];

/** An Install target the caller offers, `required` when T3 requires it, which a manual untick can't turn off. */
export type OfferedTarget = InstallTarget & { required?: boolean };

/** The User's choice for a target: ticked or unticked in Settings. */
export type TargetSelection = 'ticked' | 'unticked';

/** One Install target after an install, or a target only the manifest records. */
export interface TargetResult {
  kind: InstallTargetKind;
  /** The folder, as the first offered target that resolves to it names it. */
  path: string;
  /** Every offered path that resolves to this folder; just `path` for a target only the manifest records. */
  paths: string[];
  required: boolean;
  selection?: TargetSelection;
  /** False for a target this install left alone: unticked, not offered and not ticked, or a missing Claude home. */
  active: boolean;
  /** The Release installed there, which an unfinished install doesn't change. */
  release?: string;
  /** True once an install of `release` there completed. */
  finished: boolean;
  /** Why this install failed there. `changed` is false when it failed before replacing any file. */
  error?: { message: string; changed: boolean };
}

export interface InstallResult {
  /** False when the install wrote nothing. */
  installed: boolean;
  version: string;
  /** The bundled skills lar owns in ~/.agents/skills, which Claude targets link to. */
  skills: string[];
  /** Clashes: paths named like something this engine installs that it didn't make, left as they were. */
  conflicts: string[];
  /** Bundled skills that a path the engine didn't make blocks in an active target, in name order, with those paths. */
  blocked: SkillPaths[];
  /**
   * Drift left in place, in name order: owned skills that no longer match the installed Release, each with the
   * paths that differ. Empty on a new Release or a Replace, which overwrite it.
   */
  drift: SkillPaths[];
  /** The skills whose Drift this install overwrote, in name order. */
  replaced: string[];
  /** True when there are conflicts and no earlier install of this version has reported them. */
  warn: boolean;
  /** Every offered target, then every other target the manifest records. */
  targets: TargetResult[];
}

export interface InstallOptions {
  /** The targets to install into, deduplicated by their real path. `defaultTargets(home)` by default. */
  targets?: OfferedTarget[];
  /** The time a replacement of Drift records; the clock by default. */
  now?: () => Date;
  /**
   * False for an install whose caller doesn't show `warn` to the user, such as the check before a build, so the next
   * install of this version still warns. True by default.
   */
  recordWarning?: boolean;
  /** True for the User's Replace, which overwrites owned Drift with the bundle. False by default. */
  replace?: boolean;
}

/**
 * One bundled skill's install state. `matching` is a copy installed with a Release; `restored` is a copy whose
 * Drift a new Release or a Replace overwrote, at `restoredAt` (an ISO time); `blocked` is a skill
 * that a path the engine didn't make blocks, in `paths`, so that copy or link isn't installed.
 */
export type SkillStatus = { state: 'matching' } | { state: 'restored'; restoredAt: string } | { state: 'blocked'; paths: BlockingPath[] };

/**
 * Where a blocking path is: `agents` is `~/.agents/skills`, `antigravity` an Antigravity folder, and `profile` a
 * Claude home's `skills/`, with the home's folder name.
 */
export type BlockingPlace = { place: 'agents' | 'antigravity' } | { place: 'profile'; profile: string };

/** A path that holds a bundled skill's name, and where it is. */
export type BlockingPath = BlockingPlace & { path: string };

/** A bundled skill and the paths where it is blocked or has Drift. */
export interface SkillPaths {
  skill: string;
  paths: BlockingPath[];
}

/** Records a path the engine didn't make, and the skill it blocks and where, if it blocks one. */
type Conflict = (path: string, blocks?: BlockingPlace & { skill: string }) => void;

/** Handles an owned path of `skill` that no longer matches its Release. True when the install overwrites it. */
type Drift = (skill: string, at: BlockingPath) => boolean;

export interface ClaudeProfile {
  /** The profile's folder name in the home: `.claude` or `.claude-<name>`. */
  name: string;
  ticked: boolean;
}

/** What the engine made in one Install target. */
interface TargetState {
  kind: InstallTargetKind;
  /** The Release installed there; an unfinished install leaves the one before. */
  release?: string;
  finished: boolean;
  /** Skills whose copy, or for a Claude target whose link, the engine made there. */
  skills: string[];
  /** Each owned copy's tree digest as the engine wrote it, which tells an upgrade whether it had Drift. */
  digests?: Record<string, string>;
  selection?: TargetSelection;
  /** True when a Claude home's `references/` folder is the engine's copy, from before skills carried their own. */
  references?: boolean;
}

interface Manifest {
  /** The Release of the last install. */
  version?: string;
  /** Each bundled skill's state. Missing until the first install that records it. */
  status?: Record<string, SkillStatus>;
  /** The last version whose install reported its conflicts. */
  warned?: string;
  /** Each target by its real path. */
  targets: Record<string, TargetState>;
}

/** Why an install stopped. `changed` is false when it stopped before replacing any file. */
export class InstallError extends Error {
  readonly changed: boolean;
  constructor(message: string, changed: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InstallError';
    this.changed = changed;
  }
}

/** One folder to copy, staged next to its target before the swap. */
interface Copy {
  label: string;
  skill: string;
  source: string;
  target: string;
}

/** An offered or recorded target, resolved: `key` is its real path, the manifest's key for it. */
interface Target extends TargetResult {
  key: string;
}

/** What one target's install did so far, which a failure records so a retry knows what it owns. */
interface Work {
  owned: Set<string>;
  digests: Record<string, string>;
  changed: boolean;
}

/** The targets an install uses when the caller offers none: ~/.agents/skills, ~/.claude and Antigravity's when ~/.gemini exists. */
export function defaultTargets(home: string): OfferedTarget[] {
  return [
    { kind: 'agents', path: join(home, '.agents/skills') },
    { kind: 'claude', path: join(home, '.claude/skills') },
    ...isFolder(join(home, '.gemini')) ? ANTIGRAVITY_FOLDERS.map((folder) => ({ kind: 'antigravity' as const, path: join(home, folder) })) : [],
  ];
}

/**
 * Installs the folders in `<bundle>/skills` into each active Install target (see `TargetResult.active`): a copy in
 * ~/.agents/skills or an Antigravity folder, or in a Claude home's `skills/` a relative link to the copy in
 * `<home>/.agents/skills`. Targets with the same real path share one install and one result. The manifest in
 * `<home>/.agents` records, per target, the Release, here `version`, and the paths the engine owns; it never owns a
 * path it didn't make, even one that matches the bundle. A same-named path it doesn't own is a Clash: it stays, and
 * its path goes in `conflicts` and blocks its skill (its status and `blocked` name the paths). `warn` is true for the
 * first install of a version that has Clashes, and stays true until one with `recordWarning` reports them.
 * A target whose Release differs, or whose last install didn't finish, gets the new Release: every owned copy that
 * differs from the bundle is replaced, and `replaced` names the skills whose copies had Drift from the previous
 * Release (an edit the target's digest shows, or a deleted copy or link). It removes the skills the bundle no longer
 * has wherever the manifest records them as the engine's, while each is still a real folder or a link.
 * A target already on this Release gets only what it doesn't own yet, such as a skill whose Clash moved away. An
 * owned path that no longer matches is Drift, returned in `drift` and left as it is, unless `replace` overwrites it.
 * An install that finds nothing to write writes nothing, not even the manifest.
 * Each target installs on its own: a failure there goes in its result's `error`, and the manifest records what it
 * owns by then. A failed upgrade leaves its Release the previous one, unfinished, so the next install retries it; a
 * failure in a target already on this Release keeps it there, so its Drift stays Drift. Only a bundle or
 * manifest that can't be read or written throws an `InstallError`.
 */
export function installSkills(home: string, bundle: string, version: string, options: InstallOptions = {}): InstallResult {
  const progress = { changed: false };
  try {
    return install(home, bundle, version, {
      targets: options.targets ?? defaultTargets(home), now: options.now ?? (() => new Date()),
      recordWarning: options.recordWarning ?? true, replace: options.replace ?? false,
    }, progress);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError((error as Error).message, progress.changed, { cause: error });
  }
}

/** `installSkills` without the error wrapping. Every write sets `progress.changed`. */
function install(home: string, bundle: string, version: string, options: Required<InstallOptions>, progress: { changed: boolean }): InstallResult {
  const manifestPath = join(home, '.agents', INSTALL_MANIFEST);
  const current = readManifest(home);

  const bundled = readdirSync(join(bundle, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const digests = Object.fromEntries(bundled.map((name) => {
    try { return [name, treeDigest(join(bundle, 'skills', name), true)]; }
    catch (error) { throw new Error(`Couldn't read skill ${name} in ${bundle}: ${(error as Error).message}`, { cause: error }); }
  }));
  const conflicts: string[] = [];
  // The paths that block each bundled skill, and the paths of each skill's Drift that this install leaves.
  const blocking = new Map<string, BlockingPath[]>();
  const drifting = new Map<string, BlockingPath[]>();
  const replaced = new Set<string>();
  const conflict: Conflict = (path, blocks) => {
    conflicts.push(path);
    if (!blocks) return;
    const { skill, ...place } = blocks;
    blocking.set(skill, [...blocking.get(skill) ?? [], { ...place, path }]);
  };

  const states = { ...current?.targets };
  const agents = join(home, '.agents/skills');
  const agentsKey = targetKey(agents);
  const targets = resolveTargets(options.targets, states);
  // Copies first, so each Claude target links to the skills ~/.agents/skills owns after this install.
  for (const target of [...targets].sort((a, b) => Number(a.kind === 'claude') - Number(b.kind === 'claude'))) {
    if (!target.active) {
      const previous = states[target.key];
      if (previous) states[target.key] = leave(target, previous, bundled, outsideRoot(target.key, options.root) === undefined);
      target.skills = states[target.key]?.skills ?? target.skills;
      continue;
    }
    const previous = states[target.key] ?? { kind: target.kind, finished: false, skills: [] };
    const upgrading = previous.release !== version || !previous.finished;
    const drift: Drift = (skill, at) => {
      if (upgrading || options.replace) {
        replaced.add(skill);
        return true;
      }
      drifting.set(skill, [...drifting.get(skill) ?? [], at]);
      return false;
    };
    const work: Work = { owned: new Set(previous.skills), digests: { ...previous.digests }, changed: false };
    let error: TargetResult['error'];
    try {
      if (target.kind === 'claude') {
        const linkable = (states[agentsKey]?.skills ?? []).filter((name) => bundled.includes(name));
        linkTarget(target.path, agents, work, linkable, placeOf(target), conflict, drift);
      } else copyTarget(target, bundle, bundled, digests, previous, upgrading, work, conflict, drift);
    } catch (cause) {
      error = { message: (cause as Error).message, changed: work.changed };
    }
    if (work.changed) progress.changed = true;
    const skills = [...work.owned].sort();
    // Only a failed upgrade leaves a target unfinished. A failed check of a target already on this Release keeps it
    // current, or the next check would take it for an upgrade and overwrite its Drift.
    const state: TargetState = {
      kind: target.kind,
      ...error && upgrading ? { ...previous.release !== undefined && { release: previous.release }, finished: false } : { release: version, finished: true },
      skills,
      ...target.kind !== 'claude' && { digests: Object.fromEntries(skills.flatMap((name) => {
        const digest = error ? work.digests[name] : digests[name];
        return digest === undefined ? [] : [[name, digest]];
      })) },
      ...previous.selection && { selection: previous.selection },
      ...previous.references && { references: true },
    };
    states[target.key] = state;
    target.finished = state.finished;
    if (state.release !== undefined) target.release = state.release;
    if (error) target.error = error;
  }

  const upgrading = current?.version !== version;
  const replacedAt = options.now().toISOString();
  const status = Object.fromEntries(bundled.map((name): [string, SkillStatus] => {
    const paths = blocking.get(name);
    if (paths) return [name, { state: 'blocked', paths }];
    if (replaced.has(name)) return [name, { state: 'restored', restoredAt: replacedAt }];
    const previous = current?.status?.[name];
    return [name, !upgrading && previous && previous.state !== 'blocked' ? previous : { state: 'matching' }];
  }));
  const warn = conflicts.length > 0 && current?.warned !== version;
  const warned = warn && options.recordWarning ? version : current?.warned;
  const wroteManifest = writeManifest(manifestPath, { version, status, ...(warned !== undefined && { warned }), targets: states });
  const named = (paths: Map<string, BlockingPath[]>) => bundled.flatMap((skill) => {
    const found = paths.get(skill);
    return found ? [{ skill, paths: found }] : [];
  });
  return {
    installed: progress.changed || wroteManifest, version,
    skills: (states[agentsKey]?.skills ?? []).filter((name) => bundled.includes(name)),
    conflicts, blocked: named(blocking), drift: named(drifting), replaced: [...replaced].sort(), warn,
    targets: targets.map(({ key: _, ...result }) => result),
  };
}

/**
 * The offered targets, one per real path, then the manifest's other targets. A target of two kinds is a copy, the
 * kind of ~/.agents/skills or else Antigravity's, so a link never points at itself. It is active when T3 requires it,
 * when it is offered and not unticked, or when the User ticked it; a Claude target also needs its home folder.
 */
function resolveTargets(offered: OfferedTarget[], states: Record<string, TargetState>): Target[] {
  const rank = { agents: 0, antigravity: 1, claude: 2 };
  const targets = new Map<string, Target>();
  for (const { kind, path, required = false } of offered) {
    const key = targetKey(path);
    const target = targets.get(key);
    if (!target) {
      targets.set(key, { key, kind, path, paths: [path], required, active: true, finished: false });
      continue;
    }
    target.paths.push(path);
    target.required ||= required;
    if (rank[kind] < rank[target.kind]) target.kind = kind;
  }
  for (const [key, state] of Object.entries(states)) {
    if (!targets.has(key)) targets.set(key, { key, kind: state.kind, path: key, paths: [key], required: false, active: false, finished: false });
  }
  return [...targets.values()].map((target) => {
    const state = states[target.key];
    const offeredHere = offered.some(({ path }) => target.paths.includes(path));
    const selected = target.required || (offeredHere ? state?.selection !== 'unticked' : state?.selection === 'ticked');
    return {
      ...target,
      ...state?.selection && { selection: state.selection },
      ...state?.release !== undefined && { release: state.release },
      finished: state?.finished ?? false,
      active: selected && (target.kind !== 'claude' || isFolder(dirname(target.path))),
    };
  });
}

/**
 * The state of a recorded target this install leaves inactive: when the target is `inside` the root, without the
 * owned skills the bundle no longer has. Removing those needs no tick, so a
 * new Release cleans an unticked target or one no instance offers; it installs nothing there. A removal that fails
 * keeps that skill owned, so the next install tries again, and doesn't count as a failed install: the target isn't
 * one the build uses.
 */
function leave(target: Target, previous: TargetState, bundled: string[], inside: boolean): TargetState {
  const work: Work = { owned: new Set(previous.skills), digests: { ...previous.digests }, changed: false };
  if (inside) {
    try { removeObsolete(target, bundled, work); }
    catch { /* Kept owned for the next install. */ }
  }
  const skills = [...work.owned].sort();
  return {
    ...previous, skills,
    ...previous.digests && { digests: Object.fromEntries(Object.entries(work.digests).filter(([name]) => work.owned.has(name))) },
  };
}

/**
 * Removes the owned skills of `target` that `bundled` no longer has, each only while it is still what the engine
 * made there: a real folder in a copy target, a link in a Claude target. Stops owning each either way.
 */
function removeObsolete(target: InstallTarget, bundled: string[], work: Work): void {
  for (const skill of [...work.owned]) {
    if (bundled.includes(skill)) continue;
    const path = join(target.path, skill);
    if (target.kind === 'claude') {
      if (removeLink(path)) work.changed = true;
    } else if (isRealFolder(path)) {
      rmSync(path, { recursive: true, force: true });
      work.changed = true;
    }
    work.owned.delete(skill);
    delete work.digests[skill];
  }
}

/** Where a blocking path in `target` is. */
function placeOf(target: InstallTarget): BlockingPlace {
  if (target.kind === 'claude') return { place: 'profile', profile: basename(dirname(target.path)) };
  return { place: target.kind };
}

/**
 * Copies every bundled skill into a copy target, but for its Clashes: on an upgrade every owned copy that differs
 * from the bundle, on the same Release only what it doesn't own yet and the Drift `drift` lets it overwrite. Then
 * removes the owned skills the bundle no longer has, each only while it is still a real folder.
 */
function copyTarget(
  target: Target, bundle: string, bundled: string[], digests: Record<string, string>, previous: TargetState, upgrading: boolean,
  work: Work, conflict: Conflict, drift: Drift,
): void {
  const place = placeOf(target);
  const copies: Copy[] = bundled.filter((skill) => {
    const path = join(target.path, skill);
    if (work.owned.has(skill) || !exists(path)) return true;
    conflict(path, { skill, ...place });
    return false;
  }).filter((skill) => {
    const path = join(target.path, skill);
    if (exists(path) && treeDigest(path, false) === digests[skill]) {
      work.digests[skill] = digests[skill]!;
      return false;
    }
    if (!work.owned.has(skill)) return true;
    // An upgrade writes every owned copy; only one that changed since its Release counts as Drift.
    const recorded = previous.digests?.[skill];
    const changed = !upgrading || !exists(path) || (recorded !== undefined && treeDigest(path, false) !== recorded);
    return !changed || drift(skill, { ...place, path });
  }).map((skill) => ({
    label: target.kind === 'antigravity' ? `skill ${skill} for Antigravity` : `skill ${skill}`, skill,
    source: join(bundle, 'skills', skill), target: join(target.path, skill),
  }));

  const staged: { copy: Copy; temporary: string }[] = [];
  try {
    for (const copy of copies) staged.push({ copy, temporary: stage(copy) });
    for (const { copy, temporary } of staged) {
      swap(temporary, copy.target, work);
      work.owned.add(copy.skill);
      work.digests[copy.skill] = digests[copy.skill]!;
    }
  } finally {
    for (const { temporary } of staged) rmSync(temporary, { recursive: true, force: true });
  }
  removeObsolete(target, bundled, work);
}

/** Every Claude profile in `home`, ticked when its skills folder is an active target of the default install. */
export function listClaudeProfiles(home: string): ClaudeProfile[] {
  const manifest = readManifest(home);
  const targets = resolveTargets(defaultTargets(home), { ...manifest?.targets });
  return listProfileFolders(home).map((name) => {
    const key = targetKey(join(home, name, 'skills'));
    const target = targets.find((candidate) => candidate.key === key);
    return { name, ticked: target?.active ?? false };
  });
}

/** Each bundled skill's state from the last install, or null before the first install that records it. */
export function readSkillStatus(home: string): Record<string, SkillStatus> | null {
  return readManifest(home)?.status ?? null;
}

/** What one tick change did: the paths it left alone, and what an untick removed. */
export interface TickResult {
  conflicts: string[];
  removed: {
    /** Skills whose link the untick removed. */
    links: string[];
    /** True when the untick removed the profile's `references/` folder. */
    checklists: boolean;
  };
}

/**
 * Ticks or unticks one Claude profile's `skills/` target and applies it at once. Ticking links every skill
 * ~/.agents/skills owns and puts back a missing or wrong engine link; unticking removes only the links and checklist
 * copy the engine made, and keeps the target in the manifest. Needs an earlier install.
 */
export function setProfileTick(home: string, name: string, ticked: boolean): TickResult {
  if (!listProfileFolders(home).includes(name)) throw new Error(`${name} is not a Claude profile in ${home}`);
  const manifest = readManifest(home);
  const agentsKey = targetKey(join(home, '.agents/skills'));
  const agents = manifest?.targets[agentsKey];
  if (!manifest || !agents) throw new Error(`No skills are installed in ${join(home, '.agents')} yet`);
  const path = join(home, name, 'skills');
  const key = targetKey(path);
  const state = manifest.targets[key] ?? { kind: 'claude' as const, finished: false, skills: [] };
  const conflicts: string[] = [];
  const removed = { links: [] as string[], checklists: false };
  const work: Work = { owned: new Set(state.skills), digests: {}, changed: false };
  if (ticked) linkTarget(path, join(home, '.agents/skills'), work, agents.skills, { place: 'profile', profile: name }, (conflicting) => conflicts.push(conflicting), () => true);
  else unlinkTarget(path, state, work, removed);
  const next: TargetState = {
    kind: 'claude',
    ...ticked ? { ...agents.release !== undefined && { release: agents.release }, finished: agents.finished } : { ...state.release !== undefined && { release: state.release }, finished: state.finished },
    skills: [...work.owned].sort(), selection: ticked ? 'ticked' : 'unticked',
    ...!ticked && state.references && exists(join(dirname(path), 'references')) && { references: true },
  };
  writeManifest(join(home, '.agents', INSTALL_MANIFEST), { ...manifest, targets: { ...manifest.targets, [key]: next } });
  return { conflicts, removed };
}

function listProfileFolders(home: string): string[] {
  return readdirSync(home, { withFileTypes: true })
    .filter((entry) => isProfileName(entry.name) && isFolder(join(home, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

/** True for `.claude` or `.claude-<anything>` that is one folder name: the one rule for a Claude profile's name. */
export function isProfileName(name: string): boolean {
  return (name === '.claude' || name.startsWith('.claude-')) && isFolderName(name);
}

/**
 * Gives a Claude target `folder` a relative link per skill to its copy in `agents`, and removes the engine's links to
 * skills no longer installed while each is still a link. A path the engine didn't make goes to `conflict`, with the
 * skill it blocks, and stays, even a link to the right skill folder; so does anything but a link where the engine
 * made one, which it stops owning. An engine link that is missing or points anywhere else goes to `drift`, and is
 * put back only when that returns true. Each write sets `work.changed`.
 */
function linkTarget(folder: string, agents: string, work: Work, skills: string[], place: BlockingPlace, conflict: Conflict, drift: Drift): void {
  for (const skill of [...work.owned]) {
    if (skills.includes(skill)) continue;
    if (removeLink(join(folder, skill))) work.changed = true;
    work.owned.delete(skill);
  }
  for (const skill of skills) {
    const path = join(folder, skill);
    const target = join(agents, skill);
    const made = work.owned.has(skill);
    if (made && exists(path) && pointsAt(path, target)) continue;
    if (exists(path) && (!made || !lstatSync(path).isSymbolicLink())) {
      conflict(path, { skill, ...place });
      work.owned.delete(skill);
      continue;
    }
    if (made && !drift(skill, { ...place, path })) continue;
    removeLink(path);
    mkdirSync(folder, { recursive: true });
    symlinkSync(relative(folder, target), path);
    work.owned.add(skill);
    work.changed = true;
  }
}

/** Removes a Claude target's engine links, each while it is still a link, and its home's engine `references/` copy. */
function unlinkTarget(folder: string, state: TargetState, work: Work, removed: TickResult['removed']): void {
  for (const skill of state.skills) if (removeLink(join(folder, skill))) removed.links.push(skill);
  work.owned.clear();
  const references = join(dirname(folder), 'references');
  if (state.references && exists(references)) {
    rmSync(references, { recursive: true, force: true });
    removed.checklists = true;
  }
}

/**
 * The path's real path, resolving links in the part that exists, so two paths to one folder get one key, even
 * before the folder exists.
 */
function targetKey(path: string): string {
  const missing: string[] = [];
  let existing = resolve(path);
  for (;;) {
    try { return join(realpathSync(existing), ...missing.reverse()); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || dirname(existing) === existing) return resolve(path);
      missing.push(basename(existing));
      existing = dirname(existing);
    }
  }
}

/**
 * Reads the manifest in `<home>/.agents`, or null when there is none, with its fields in the order the engine writes
 * them. A manifest from before Install targets becomes targets in `home`: ~/.agents/skills, each profile's `skills/`,
 * ticked or unticked, and each Antigravity folder, all on its Release. Names that aren't one folder name are dropped,
 * and so are statuses and entries that aren't an object of the right shape; a field of the wrong type reads as unset.
 */
function readManifest(home: string): Manifest | null {
  const path = join(home, '.agents', INSTALL_MANIFEST);
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(parsed)) throw new Error('it is not an object');
    manifest = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new InstallError(`Couldn't read ${path}: ${(error as Error).message}. Delete that file and start Lar Factory again.`, false, { cause: error });
  }
  const status = isRecord(manifest.status) ? Object.fromEntries(Object.entries<unknown>(manifest.status)
    .filter((entry): entry is [string, SkillStatus] => isFolderName(entry[0]) && isSkillStatus(entry[1]))) : undefined;
  const targets = isRecord(manifest.targets) ? readTargets(manifest.targets) : migrate(home, manifest);
  return {
    ...(typeof manifest.version === 'string' && { version: manifest.version }),
    ...(status && { status }),
    ...(typeof manifest.warned === 'string' && { warned: manifest.warned }),
    targets,
  };
}

const KINDS: readonly InstallTargetKind[] = ['agents', 'antigravity', 'claude'];

/** The manifest's targets, keyed again by their real paths, without entries that aren't a target at an absolute path. */
function readTargets(entries: Record<string, unknown>): Record<string, TargetState> {
  const targets: Record<string, TargetState> = {};
  for (const [path, state] of Object.entries(entries)) {
    if (!isAbsolute(path) || !isRecord(state) || !KINDS.includes(state.kind as InstallTargetKind)) continue;
    const key = targetKey(path);
    targets[key] ??= {
      kind: state.kind as InstallTargetKind,
      ...typeof state.release === 'string' && { release: state.release },
      finished: state.finished === true,
      skills: names(state.skills),
      ...isRecord(state.digests) && { digests: readDigests(state.digests) },
      ...(state.selection === 'ticked' || state.selection === 'unticked') && { selection: state.selection },
      ...state.references === true && { references: true },
    };
  }
  return targets;
}

/** The targets a manifest from before Install targets records in `home`, each finished on its Release. */
function migrate(home: string, legacy: Record<string, unknown>): Record<string, TargetState> {
  const release = typeof legacy.version === 'string' ? { release: legacy.version } : {};
  const digests = isRecord(legacy.digests) ? readDigests(legacy.digests) : undefined;
  const copies = (kind: 'agents' | 'antigravity', skills: string[]): TargetState => ({
    kind, ...release, finished: true, skills,
    ...digests && { digests: Object.fromEntries(skills.flatMap((name) => digests[name] === undefined ? [] : [[name, digests[name]]])) },
  });
  const targets: Record<string, TargetState> = { [targetKey(join(home, '.agents/skills'))]: copies('agents', names(legacy.skills)) };
  for (const [name, state] of isRecord(legacy.profiles) ? Object.entries(legacy.profiles) : []) {
    if (!isProfileName(name) || !isRecord(state)) continue;
    targets[targetKey(join(home, name, 'skills'))] = {
      kind: 'claude', ...release, finished: true, skills: state.ticked === true ? names(state.links) : [],
      selection: state.ticked === true ? 'ticked' : 'unticked', ...state.references === true && { references: true },
    };
  }
  for (const [folder, skills] of isRecord(legacy.antigravity) ? Object.entries(legacy.antigravity) : []) {
    if (ANTIGRAVITY_FOLDERS.includes(folder) && Array.isArray(skills)) targets[targetKey(join(home, folder))] = copies('antigravity', names(skills));
  }
  return targets;
}

/** The one-folder names in a list, or none when it isn't one. */
function names(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).filter(isFolderName);
}

function readDigests(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => isFolderName(entry[0]) && typeof entry[1] === 'string'));
}

/** Removes `path` only when it is still a link, so something put in its place survives. True when it removed one. */
function removeLink(path: string): boolean {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    rmSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

function pointsAt(path: string, target: string): boolean {
  if (!lstatSync(path).isSymbolicLink()) return false;
  try { return realpathSync(path) === realpathSync(target); }
  catch { return false; }
}

/** True when `path` itself is a folder, not a link to one. */
function isRealFolder(path: string): boolean {
  try { return lstatSync(path).isDirectory(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function isFolder(path: string): boolean {
  try { return statSync(path).isDirectory(); }
  catch { return false; }
}

/** Writes `manifest`, its targets in path order, unless the file already holds exactly that. True when it wrote. */
function writeManifest(path: string, manifest: Manifest): boolean {
  const targets = Object.fromEntries(Object.entries(manifest.targets).sort(([a], [b]) => a.localeCompare(b)));
  const text = `${JSON.stringify({ ...manifest, targets }, null, 2)}\n`;
  try { if (readFileSync(path, 'utf8') === text) return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
  return true;
}

/**
 * A digest of the tree at `path`: its file names, contents and file modes. With `follow`, a link counts as what it
 * points at, as `stage` copies it; without, it differs from any folder or file.
 */
function treeDigest(path: string, follow: boolean): string {
  const hash = createHash('sha256');
  const add = (path: string, name: string) => {
    const stats = follow ? statSync(path) : lstatSync(path);
    if (stats.isDirectory()) {
      hash.update(`folder ${name}\0`);
      for (const entry of readdirSync(path).sort()) add(join(path, entry), `${name}/${entry}`);
    } else if (stats.isFile()) hash.update(`file ${name} ${stats.mode} ${stats.size}\0`).update(readFileSync(path));
    else hash.update(`other ${name}\0`);
  };
  add(path, '.');
  return hash.digest('hex');
}

/** True when anything, even a dangling link, holds `path`. */
function exists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function isSkillStatus(value: unknown): value is SkillStatus {
  if (!isRecord(value)) return false;
  if (value.state === 'restored') return typeof value.restoredAt === 'string';
  if (value.state === 'blocked') return Array.isArray(value.paths) && value.paths.every(isBlockingPath);
  return value.state === 'matching';
}

function isBlockingPath(value: unknown): value is BlockingPath {
  if (!isRecord(value) || typeof value.path !== 'string') return false;
  return value.place === 'agents' || value.place === 'antigravity' || (value.place === 'profile' && typeof value.profile === 'string' && isProfileName(value.profile));
}

/** True for one folder name: not empty, not `.` or `..`, no slash. */
function isFolderName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && basename(name) === name;
}

/** Copies `copy.source` into a hidden folder beside its target and returns that folder. */
function stage(copy: Copy): string {
  const parent = dirname(copy.target);
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(join(parent, `.${basename(copy.target)}.installing-`));
  try {
    cpSync(copy.source, temporary, { recursive: true, dereference: true });
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw new Error(`Couldn't copy ${copy.label} from ${copy.source}: ${(error as Error).message}`, { cause: error });
  }
  return temporary;
}

/**
 * Moves `temporary` into `target`'s place and deletes whatever was there. If the move fails, the old `target`
 * goes back in place. If that also fails, the old copy stays in the `.previous` folder next to `target`.
 * Sets `progress.changed` once the new copy is in place, even if deleting the old one then fails.
 */
function swap(temporary: string, target: string, progress = { changed: false }): void {
  const previous = `${temporary}.previous`;
  let moved = true;
  try { renameSync(target, previous); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    moved = false;
  }
  let keepPrevious = false;
  try {
    renameSync(temporary, target);
    progress.changed = true;
  } catch (error) {
    // If even this fails, the target stays missing until the next install, and `.previous` keeps the old copy.
    if (moved) try { renameSync(previous, target); } catch { keepPrevious = true; }
    throw error;
  } finally {
    if (!keepPrevious) rmSync(previous, { recursive: true, force: true });
  }
}
