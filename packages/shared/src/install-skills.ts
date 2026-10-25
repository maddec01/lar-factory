// Installs a bundle's skills and checklists into a home's ~/.agents, once per app version,
// and links them into the ticked Claude profiles (~/.claude and each ~/.claude-*).

import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { isRecord } from './is-record.ts';

/** The manifest's file name in ~/.agents. The skills CLI owns .skill-lock.json, so this never touches it. */
export const INSTALL_MANIFEST = '.lar-factory-install.json';

export interface InstallResult {
  /** False when the manifest already named this version and nothing was copied. */
  installed: boolean;
  version: string;
  skills: string[];
  /** Paths named like something this engine installs that it didn't make, left as they were. */
  conflicts: string[];
}

export interface ClaudeProfile {
  /** The profile's folder name in the home: `.claude` or `.claude-<name>`. */
  name: string;
  ticked: boolean;
}

/** What the engine made in one Claude profile. */
interface ProfileState {
  ticked: boolean;
  /** Skills whose link in the profile's `skills/` folder the engine made or adopted. */
  links: string[];
  /** True when the profile's `references/` folder is the engine's copy. */
  references: boolean;
}

interface Manifest {
  version: string;
  skills: string[];
  /** Every profile the engine has seen. Missing until the first install that handles profiles. */
  profiles?: Record<string, ProfileState>;
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
  source: string;
  target: string;
}

/**
 * Copies every folder in `<bundle>/skills` to `<home>/.agents/skills/<name>` and `<bundle>/references`
 * to `<home>/.agents/references`, unless the manifest already names `version`. `force` installs anyway.
 * The manifest lists the skills this engine owns. The first install adopts any folder named like a bundled
 * skill; later installs skip such a folder unless the manifest lists it, and return its path in `conflicts`.
 * An upgrade removes owned skills the bundle no longer has. Other folders are never touched.
 * Each install then refreshes the ticked Claude profiles (see `setProfileTick`). The first install that sees
 * profiles ticks all of them and takes over each profile's `references/` folder; later profiles start unticked.
 * Any failure throws an `InstallError` and leaves the manifest as it was. If it fails before the first copy moves
 * into place, such as while staging the copies, the files stay the previous version and `changed` is false.
 * If a swap fails partway, some files may be the new version and some the old.
 */
export function installSkills(home: string, bundle: string, version: string, options: { force?: boolean } = {}): InstallResult {
  const progress = { changed: false };
  try {
    return install(home, bundle, version, options.force ?? false, progress);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError((error as Error).message, progress.changed, { cause: error });
  }
}

/** `installSkills` without the error wrapping. `swap` sets `progress.changed` once the first copy is in place. */
function install(home: string, bundle: string, version: string, force: boolean, progress: { changed: boolean }): InstallResult {
  const agents = join(home, '.agents');
  const manifestPath = join(agents, INSTALL_MANIFEST);
  const current = readManifest(manifestPath);
  if (current?.version === version && !force) return { installed: false, version, skills: current.skills, conflicts: [] };

  const bundled = readdirSync(join(bundle, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const owned = new Set(current?.skills ?? bundled);
  const conflicting = bundled.filter((name) => !owned.has(name) && exists(join(agents, 'skills', name)));
  const skills = bundled.filter((name) => !conflicting.includes(name));
  const dropped = [...owned].filter((name) => !bundled.includes(name));
  const copies: Copy[] = [
    ...skills.map((name) => ({ label: `skill ${name}`, source: join(bundle, 'skills', name), target: join(agents, 'skills', name) })),
    { label: 'references', source: join(bundle, 'references'), target: join(agents, 'references') },
  ];

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
  for (const name of dropped) rmSync(join(agents, 'skills', name), { recursive: true, force: true });

  const first = !current?.profiles;
  const profiles = { ...current?.profiles };
  const conflicts = conflicting.map((name) => join(agents, 'skills', name));
  for (const name of listProfileFolders(home)) {
    profiles[name] ??= { ticked: first, links: [], references: false };
  }
  for (const [name, state] of Object.entries(profiles)) {
    if (!exists(join(home, name))) continue;
    if (state.ticked) profiles[name] = linkProfile(home, name, state, skills, first, conflicts);
  }

  const manifest: Manifest = { version, skills, profiles };
  writeManifest(manifestPath, manifest);
  return { installed: true, version, skills, conflicts };
}

/** Every Claude profile in `home`, ticked when the engine links skills into it. */
export function listClaudeProfiles(home: string): ClaudeProfile[] {
  const profiles = readManifest(join(home, '.agents', INSTALL_MANIFEST))?.profiles;
  return listProfileFolders(home).map((name) => ({ name, ticked: profiles ? profiles[name]?.ticked ?? false : true }));
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
 * Ticks or unticks one Claude profile and applies it at once. Ticking links every installed skill and copies the
 * checklists; unticking removes only the links and checklist copy the engine made. Needs an earlier install.
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
  profiles[name] = ticked ? linkProfile(home, name, state, manifest.skills, false, conflicts) : unlinkProfile(home, name, state, removed);
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
 * Gives a profile a relative link per skill and a fresh checklist copy, and removes its links to skills no
 * longer installed. A link that already points at the right skill folder is adopted. Any other path the engine
 * didn't make is a conflict and stays, except `references/`: with `adopt`, the engine replaces whatever is there
 * with its checklist copy.
 */
function linkProfile(home: string, name: string, state: ProfileState, skills: string[], adopt: boolean, conflicts: string[]): ProfileState {
  const folder = join(home, name, 'skills');
  const links = state.links.filter((skill) => skills.includes(skill));
  for (const skill of state.links) if (!links.includes(skill)) removeLink(join(folder, skill));
  mkdirSync(folder, { recursive: true });
  for (const skill of skills) {
    const path = join(folder, skill);
    const target = join(home, '.agents/skills', skill);
    if (links.includes(skill)) {
      if (exists(path)) continue;
    } else if (exists(path)) {
      if (pointsAt(path, target)) links.push(skill);
      else conflicts.push(path);
      continue;
    } else links.push(skill);
    symlinkSync(relative(folder, target), path);
  }

  const references = join(home, name, 'references');
  const ours = state.references || adopt || !exists(references);
  if (ours) {
    const copy = { label: `references for ${name}`, source: join(home, '.agents/references'), target: references };
    swap(stage(copy), references);
  } else conflicts.push(references);
  return { ticked: true, links: links.sort(), references: ours };
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

function isFolder(path: string): boolean {
  try { return statSync(path).isDirectory(); }
  catch { return false; }
}

function writeManifest(path: string, manifest: Manifest): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporary, path);
}

/** True when anything, even a dangling link, holds `path`. */
function exists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/**
 * Reads the manifest, or null when there is none. Names that aren't one folder name are dropped, and so are
 * profile entries that aren't an object; a profile field of the wrong type reads as false or empty.
 */
function readManifest(path: string): Manifest | null {
  let manifest: Manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new InstallError(`Couldn't read ${path}: ${(error as Error).message}. Delete that file and start lar Factory again.`, false, { cause: error });
  }
  const profiles = isRecord(manifest.profiles) ? Object.fromEntries(Object.entries<unknown>(manifest.profiles)
    .filter((entry): entry is [string, Record<string, unknown>] => isProfileName(entry[0]) && isRecord(entry[1]))
    .map(([name, state]) => [name, {
      ticked: state.ticked === true,
      links: (Array.isArray(state.links) ? state.links : []).filter(isFolderName),
      references: state.references === true,
    }])) : undefined;
  return { ...manifest, skills: (Array.isArray(manifest.skills) ? manifest.skills : []).filter(isFolderName), ...(profiles && { profiles }) };
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
