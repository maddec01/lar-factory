// Installs a bundle's skills into a home's ~/.agents when its Release changes, links them into the ticked Claude
// profiles (~/.claude and each ~/.claude-*), and copies them into Antigravity's skill folders in ~/.gemini. Between
// Releases it only reports Drift, unless the User chooses Replace.

import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative } from 'node:path';
import { isRecord } from './is-record.ts';

/** The manifest's file name in ~/.agents. The skills CLI owns .skill-lock.json, so this never touches it. */
export const INSTALL_MANIFEST = '.lar-factory-install.json';

/**
 * Antigravity's skill folders, relative to the home: the app's and the CLI's. Antigravity reads neither
 * ~/.agents/skills nor Claude's folders, so each gets a copy of every skill. Copies, not links: T3 shows Antigravity
 * follows a linked skills folder, but nothing shows it follows a link per skill inside one.
 */
const ANTIGRAVITY_FOLDERS = ['.gemini/config/skills', '.gemini/antigravity-cli/skills'];

export interface InstallResult {
  /** False when the install wrote nothing. */
  installed: boolean;
  version: string;
  skills: string[];
  /** Clashes: paths named like something this engine installs that it didn't make, left as they were. */
  conflicts: string[];
  /**
   * Bundled skills that a path the engine didn't make blocks, in name order, each with those paths: in
   * `~/.agents/skills`, which leaves the skill uninstalled, in an Antigravity folder or in a ticked profile's `skills/`.
   */
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
}

export interface InstallOptions {
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
 * ticked Claude profile's `skills/`, with the profile's folder name in the home.
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

/** What the engine made in one Claude profile. */
interface ProfileState {
  ticked: boolean;
  /** Skills whose link in the profile's `skills/` folder the engine made. */
  links: string[];
  /** True when the profile's `references/` folder is the engine's copy. */
  references: boolean;
}

interface Manifest {
  version: string;
  skills: string[];
  /** Each owned skill's tree digest in `version`, which tells an upgrade whether its copies had Drift. */
  digests?: Record<string, string>;
  /** Each bundled skill's state. Missing until the first install that records it. */
  status?: Record<string, SkillStatus>;
  /** The last version whose install reported its conflicts. */
  warned?: string;
  /** Every profile the engine has seen. Missing until the first install that handles profiles. */
  profiles?: Record<string, ProfileState>;
  /** The skills whose copy the engine made in each Antigravity folder. Missing when ~/.gemini doesn't exist. */
  antigravity?: Record<string, string[]>;
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
  /** True when the manifest records the target as the engine's. */
  owned: boolean;
  place: BlockingPlace;
  source: string;
  target: string;
}

/**
 * Installs the folders in `<bundle>/skills` into `<home>/.agents/skills/<name>`, each Antigravity folder when
 * ~/.gemini exists, and the ticked Claude profiles (see `setProfileTick`). The manifest records the Release, here
 * `version`, and the paths the engine owns; it never owns a path it didn't make, even one that matches the bundle.
 * A same-named path it doesn't own is a Clash: it stays, and its path goes in `conflicts` and blocks its skill (its
 * status and `blocked` name the paths). `warn` is true for the first install of a version that has Clashes, and stays
 * true until one with `recordWarning` reports them.
 * A new Release, the first install included, replaces every owned copy that differs from the bundle and records,
 * as `replaced`, the skills whose copies had Drift from the previous Release (an edit the manifest's digest shows, or
 * a deleted copy or link). It removes the skills the bundle no longer has from every place the manifest records as
 * the engine's, while each is still a real folder or a link.
 * The same Release writes only what it doesn't own yet: a skill whose Clash moved away or a new Antigravity folder.
 * An owned path that no longer matches is Drift, returned in `drift` and left as it is, unless `replace` overwrites
 * it. An install that finds nothing to write writes nothing, not even the manifest.
 * The first install that sees profiles ticks all of them; later profiles start unticked.
 * Any failure throws an `InstallError` and leaves the manifest as it was. If it fails before the first copy moves
 * into place, such as while staging the copies, the files stay the previous version and `changed` is false.
 * If a swap fails partway, some files may be the new version and some the old.
 */
export function installSkills(home: string, bundle: string, version: string, options: InstallOptions = {}): InstallResult {
  const progress = { changed: false };
  try {
    return install(home, bundle, version, {
      now: options.now ?? (() => new Date()), recordWarning: options.recordWarning ?? true, replace: options.replace ?? false,
    }, progress);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError((error as Error).message, progress.changed, { cause: error });
  }
}

/** `installSkills` without the error wrapping. Every write sets `progress.changed`, `swap` once the copy is in place. */
function install(home: string, bundle: string, version: string, options: Required<InstallOptions>, progress: { changed: boolean }): InstallResult {
  const agents = join(home, '.agents');
  const manifestPath = join(agents, INSTALL_MANIFEST);
  const current = readManifest(manifestPath);
  const upgrading = current?.version !== version;

  const bundled = readdirSync(join(bundle, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const digests = Object.fromEntries(bundled.map((name) => {
    try { return [name, treeDigest(join(bundle, 'skills', name), true)]; }
    catch (error) { throw new Error(`Couldn't read skill ${name} in ${bundle}: ${(error as Error).message}`, { cause: error }); }
  }));
  const owned = new Set(current?.skills ?? []);
  const conflicting = bundled.filter((name) => !owned.has(name) && exists(join(agents, 'skills', name)));
  const skills = bundled.filter((name) => !conflicting.includes(name));
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
  const drift: Drift = (skill, at) => {
    if (upgrading || options.replace) {
      replaced.add(skill);
      return true;
    }
    drifting.set(skill, [...drifting.get(skill) ?? [], at]);
    return false;
  };
  for (const name of conflicting) conflict(join(agents, 'skills', name), { skill: name, place: 'agents' });
  const antigravity = isFolder(join(home, '.gemini'))
    ? Object.fromEntries(ANTIGRAVITY_FOLDERS.map((folder) => [folder, skills.filter((name) => {
      const target = join(home, folder, name);
      if (current?.antigravity?.[folder]?.includes(name) || !exists(target)) return true;
      conflict(target, { skill: name, place: 'antigravity' });
      return false;
    })]))
    : undefined;
  const copies: Copy[] = [
    ...skills.map((name) => ({
      label: `skill ${name}`, skill: name, owned: owned.has(name), place: { place: 'agents' as const },
      source: join(bundle, 'skills', name), target: join(agents, 'skills', name),
    })),
    ...Object.entries(antigravity ?? {}).flatMap(([folder, names]) => names.map((name) => ({
      label: `skill ${name} for Antigravity`, skill: name, owned: current?.antigravity?.[folder]?.includes(name) ?? false,
      place: { place: 'antigravity' as const }, source: join(bundle, 'skills', name), target: join(home, folder, name),
    }))),
  ].filter((copy) => {
    if (exists(copy.target) && treeDigest(copy.target, false) === digests[copy.skill]) return false;
    if (!copy.owned) return true;
    // An upgrade writes every owned copy; only one that changed since its Release counts as Drift.
    const recorded = current?.digests?.[copy.skill];
    const changed = !upgrading || !exists(copy.target) || (recorded !== undefined && treeDigest(copy.target, false) !== recorded);
    return !changed || drift(copy.skill, { ...copy.place, path: copy.target });
  });

  const staged: { copy: Copy; temporary: string }[] = [];
  try {
    for (const copy of copies) staged.push({ copy, temporary: stage(copy) });
  } catch (error) {
    for (const { temporary } of staged) rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  try {
    for (const { copy, temporary } of staged) swap(temporary, copy.target, progress);
  } finally {
    for (const { temporary } of staged) rmSync(temporary, { recursive: true, force: true });
  }
  // Owned skills the bundle no longer has. Each goes only while it is still a folder, so a link or file put in its
  // place survives.
  const removals = [
    ...[...owned].filter((name) => !bundled.includes(name)).map((name) => join(agents, 'skills', name)),
    ...Object.entries(current?.antigravity ?? {}).flatMap(([folder, names]) =>
      names.filter((name) => !antigravity?.[folder]?.includes(name)).map((name) => join(home, folder, name))),
  ].filter(isRealFolder);
  for (const path of removals) {
    rmSync(path, { recursive: true, force: true });
    progress.changed = true;
  }

  const first = !current?.profiles;
  const profiles = { ...current?.profiles };
  for (const name of listProfileFolders(home)) {
    profiles[name] ??= { ticked: first, links: [], references: false };
  }
  for (const [name, state] of Object.entries(profiles)) {
    if (!exists(join(home, name))) continue;
    if (state.ticked) profiles[name] = linkProfile(home, name, state, skills, conflict, drift, progress);
  }

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
  const manifest: Manifest = {
    version, skills, digests: Object.fromEntries(skills.map((name) => [name, digests[name]!])), status,
    ...(warned !== undefined && { warned }), profiles, ...(antigravity && { antigravity }),
  };
  const wroteManifest = writeManifest(manifestPath, manifest);
  const named = (paths: Map<string, BlockingPath[]>) => bundled.flatMap((skill) => {
    const found = paths.get(skill);
    return found ? [{ skill, paths: found }] : [];
  });
  return {
    installed: progress.changed || wroteManifest, version, skills, conflicts, blocked: named(blocking), drift: named(drifting),
    replaced: [...replaced].sort(), warn,
  };
}

/** Every Claude profile in `home`, ticked when the engine links skills into it. */
export function listClaudeProfiles(home: string): ClaudeProfile[] {
  const profiles = readManifest(join(home, '.agents', INSTALL_MANIFEST))?.profiles;
  return listProfileFolders(home).map((name) => ({ name, ticked: profiles ? profiles[name]?.ticked ?? false : true }));
}

/** Each bundled skill's state from the last install, or null before the first install that records it. */
export function readSkillStatus(home: string): Record<string, SkillStatus> | null {
  return readManifest(join(home, '.agents', INSTALL_MANIFEST))?.status ?? null;
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
 * Ticks or unticks one Claude profile and applies it at once. Ticking links every installed skill and puts back a
 * missing or wrong engine link; unticking removes only the links and checklist copy the engine made. Needs an
 * earlier install.
 */
export function setProfileTick(home: string, name: string, ticked: boolean): TickResult {
  if (!listProfileFolders(home).includes(name)) throw new Error(`${name} is not a Claude profile in ${home}`);
  const manifestPath = join(home, '.agents', INSTALL_MANIFEST);
  const manifest = readManifest(manifestPath);
  if (!manifest) throw new Error(`No skills are installed in ${join(home, '.agents')} yet`);
  const profiles = { ...manifest.profiles };
  const state = { ...(profiles[name] ?? { links: [], references: false }), ticked };
  const conflicts: string[] = [];
  const removed = { links: [] as string[], checklists: false };
  profiles[name] = ticked ? linkProfile(home, name, state, manifest.skills, (path) => conflicts.push(path), () => true, { changed: false }) : unlinkProfile(home, name, state, removed);
  writeManifest(manifestPath, { ...manifest, profiles });
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
 * Gives a profile a relative link per skill, and removes the engine's links to skills no longer installed while
 * each is still a link. A path the engine didn't make goes to `conflict`, with the skill it blocks, and stays, even a
 * link to the right skill folder; so does anything but a link where the engine made one, which it stops owning. An
 * engine link that is missing or points anywhere else goes to `drift`, and is put back only when that returns true.
 * Each write sets `progress.changed`.
 */
function linkProfile(
  home: string, name: string, state: ProfileState, skills: string[], conflict: Conflict, drift: Drift, progress: { changed: boolean },
): ProfileState {
  const folder = join(home, name, 'skills');
  const links = state.links.filter((skill) => {
    if (skills.includes(skill)) return true;
    if (removeLink(join(folder, skill))) progress.changed = true;
    return false;
  });
  for (const skill of skills) {
    const path = join(folder, skill);
    const target = join(home, '.agents/skills', skill);
    const made = links.includes(skill);
    if (made && exists(path) && pointsAt(path, target)) continue;
    if (exists(path) && (!made || !lstatSync(path).isSymbolicLink())) {
      conflict(path, { skill, place: 'profile', profile: name });
      if (made) links.splice(links.indexOf(skill), 1);
      continue;
    }
    if (made && !drift(skill, { place: 'profile', profile: name, path })) continue;
    removeLink(path);
    mkdirSync(folder, { recursive: true });
    symlinkSync(relative(folder, target), path);
    if (!made) links.push(skill);
    progress.changed = true;
  }

  return { ticked: true, links: links.sort(), references: state.references };
}

function unlinkProfile(home: string, name: string, state: ProfileState, removed: TickResult['removed']): ProfileState {
  for (const skill of state.links) if (removeLink(join(home, name, 'skills', skill))) removed.links.push(skill);
  const references = join(home, name, 'references');
  if (state.references && exists(references)) {
    rmSync(references, { recursive: true, force: true });
    removed.checklists = true;
  }
  return { ticked: false, links: [], references: false };
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

/** Writes `manifest` unless the file already holds exactly that. True when it wrote. */
function writeManifest(path: string, manifest: Manifest): boolean {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  try { if (readFileSync(path, 'utf8') === text) return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
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

/**
 * Reads the manifest, or null when there is none, with its fields in the order the engine writes them. Names that
 * aren't one folder name are dropped, and so are statuses and profile entries that aren't an object of the right
 * shape; a profile field of the wrong type reads as false or empty.
 */
function readManifest(path: string): Manifest | null {
  let manifest: Manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new InstallError(`Couldn't read ${path}: ${(error as Error).message}. Delete that file and start Lar Factory again.`, false, { cause: error });
  }
  const profiles = isRecord(manifest.profiles) ? Object.fromEntries(Object.entries<unknown>(manifest.profiles)
    .filter((entry): entry is [string, Record<string, unknown>] => isProfileName(entry[0]) && isRecord(entry[1]))
    .map(([name, state]) => [name, {
      ticked: state.ticked === true,
      links: (Array.isArray(state.links) ? state.links : []).filter(isFolderName),
      references: state.references === true,
    }])) : undefined;
  const status = isRecord(manifest.status) ? Object.fromEntries(Object.entries<unknown>(manifest.status)
    .filter((entry): entry is [string, SkillStatus] => isFolderName(entry[0]) && isSkillStatus(entry[1]))) : undefined;
  const digests = isRecord(manifest.digests) ? Object.fromEntries(Object.entries<unknown>(manifest.digests)
    .filter((entry): entry is [string, string] => isFolderName(entry[0]) && typeof entry[1] === 'string')) : undefined;
  const antigravity = isRecord(manifest.antigravity) ? Object.fromEntries(Object.entries<unknown>(manifest.antigravity)
    .filter((entry): entry is [string, unknown[]] => ANTIGRAVITY_FOLDERS.includes(entry[0]) && Array.isArray(entry[1]))
    .map(([folder, names]) => [folder, names.filter(isFolderName)])) : undefined;
  return {
    version: manifest.version,
    skills: (Array.isArray(manifest.skills) ? manifest.skills : []).filter(isFolderName),
    ...(digests && { digests }),
    ...(status && { status }),
    ...(typeof manifest.warned === 'string' && { warned: manifest.warned }),
    ...(profiles && { profiles }),
    ...(antigravity && { antigravity }),
  };
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
