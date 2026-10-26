// Installs a bundle's skills and checklists into a home's ~/.agents, restoring any installed copy that differs,
// links them into the ticked Claude profiles (~/.claude and each ~/.claude-*), and copies the skills into
// Antigravity's skill folders in ~/.gemini.

import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
  /** False when everything already matched the bundle and nothing was written. */
  installed: boolean;
  version: string;
  skills: string[];
  /** Paths named like something this engine installs that it didn't make, left as they were. */
  conflicts: string[];
  /** True when there are conflicts and no earlier install of this version has reported them. */
  warn: boolean;
}

/**
 * One bundled skill's install state. `matching` is a copy installed with a Release; `restored` is a copy the
 * engine overwrote because it no longer matched the Release, at `restoredAt` (an ISO time); `blocked` is a skill
 * whose folder the engine didn't make, so it isn't installed.
 */
export type SkillStatus = { state: 'matching' } | { state: 'restored'; restoredAt: string } | { state: 'blocked' };

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
  /** The bundled skill whose status a restore of this copy marks, if any. */
  skill?: string;
  source: string;
  target: string;
}

/**
 * Copies every folder in `<bundle>/skills` to `<home>/.agents/skills/<name>` and `<bundle>/references`
 * to `<home>/.agents/references`, whatever version the manifest names. A folder whose files, contents and file
 * modes all match the bundle is left alone; one that differs is replaced whole, with no merge. Putting back an
 * earlier copy or ticked profile link while the manifest already names `version` is a restore, recorded with `now`
 * in the skill's status; a skill's first copy, such as after the folder that blocked it moved away, is an install.
 * An install that finds everything matching writes nothing, not even the manifest.
 * The manifest lists the skills this engine owns. The first install adopts any folder named like a bundled
 * skill; later installs skip such a folder unless the manifest lists it, and return its path in `conflicts`. `warn` is
 * true for the first install of a version that has conflicts.
 * An upgrade removes owned skills the bundle no longer has. Other folders are never touched.
 * When ~/.gemini exists, each Antigravity folder gets the same copies, checked and restored the same way. There a
 * path the engine didn't make is a conflict, unless it already matches the bundle, so the engine adopts it.
 * Each install then refreshes the ticked Claude profiles (see `setProfileTick`). The first install that sees
 * profiles ticks all of them and takes over each profile's `references/` folder; later profiles start unticked.
 * Any failure throws an `InstallError` and leaves the manifest as it was. If it fails before the first copy moves
 * into place, such as while staging the copies, the files stay the previous version and `changed` is false.
 * If a swap fails partway, some files may be the new version and some the old.
 */
export function installSkills(home: string, bundle: string, version: string, options: { now?: () => Date } = {}): InstallResult {
  const progress = { changed: false };
  try {
    return install(home, bundle, version, options.now ?? (() => new Date()), progress);
  } catch (error) {
    if (error instanceof InstallError) throw error;
    throw new InstallError((error as Error).message, progress.changed, { cause: error });
  }
}

/** `installSkills` without the error wrapping. Every write sets `progress.changed`, `swap` once the copy is in place. */
function install(home: string, bundle: string, version: string, now: () => Date, progress: { changed: boolean }): InstallResult {
  const agents = join(home, '.agents');
  const manifestPath = join(agents, INSTALL_MANIFEST);
  const current = readManifest(manifestPath);

  const bundled = readdirSync(join(bundle, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const owned = new Set(current?.skills ?? bundled);
  const conflicting = bundled.filter((name) => !owned.has(name) && exists(join(agents, 'skills', name)));
  const skills = bundled.filter((name) => !conflicting.includes(name));
  const dropped = [...owned].filter((name) => !bundled.includes(name));
  const conflicts = conflicting.map((name) => join(agents, 'skills', name));
  const antigravity = isFolder(join(home, '.gemini'))
    ? Object.fromEntries(ANTIGRAVITY_FOLDERS.map((folder) => [folder, skills.filter((name) => {
      const target = join(home, folder, name);
      if (current?.antigravity?.[folder]?.includes(name) || !exists(target) || sameTree(join(bundle, 'skills', name), target)) return true;
      conflicts.push(target);
      return false;
    })]))
    : undefined;
  const copies: Copy[] = [
    // A first copy of a skill into a folder is an install, not a restore.
    ...skills.map((name) => ({
      label: `skill ${name}`, ...(current?.skills.includes(name) && { skill: name }),
      source: join(bundle, 'skills', name), target: join(agents, 'skills', name),
    })),
    ...Object.entries(antigravity ?? {}).flatMap(([folder, names]) => names.map((name) => ({
      label: `skill ${name} for Antigravity`,
      ...(current?.antigravity?.[folder]?.includes(name) && { skill: name }),
      source: join(bundle, 'skills', name), target: join(home, folder, name),
    }))),
    { label: 'references', source: join(bundle, 'references'), target: join(agents, 'references') },
  ].filter((copy) => !sameTree(copy.source, copy.target));

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
  // An Antigravity copy goes only while it is still a folder, so a link or file put in its place survives.
  const removals = [
    ...dropped.map((name) => join(agents, 'skills', name)).filter(exists),
    ...Object.entries(current?.antigravity ?? {}).flatMap(([folder, names]) =>
      names.filter((name) => !antigravity?.[folder]?.includes(name)).map((name) => join(home, folder, name))).filter(isRealFolder),
  ];
  for (const path of removals) {
    rmSync(path, { recursive: true, force: true });
    progress.changed = true;
  }

  const first = !current?.profiles;
  const profiles = { ...current?.profiles };
  for (const name of listProfileFolders(home)) {
    profiles[name] ??= { ticked: first, links: [], references: false };
  }
  // The skills whose earlier copy or profile link this install put back.
  const putBack = new Set(copies.flatMap((copy) => copy.skill ?? []));
  for (const [name, state] of Object.entries(profiles)) {
    if (!exists(join(home, name))) continue;
    if (state.ticked) profiles[name] = linkProfile(home, name, state, skills, first, conflicts, progress, putBack);
  }

  const restoring = current?.version === version;
  const restoredAt = now().toISOString();
  const status = Object.fromEntries(bundled.map((name): [string, SkillStatus] => {
    if (conflicting.includes(name)) return [name, { state: 'blocked' }];
    if (putBack.has(name)) return [name, restoring ? { state: 'restored', restoredAt } : { state: 'matching' }];
    const previous = current?.status?.[name];
    return [name, previous && previous.state !== 'blocked' ? previous : { state: 'matching' }];
  }));
  const warn = conflicts.length > 0 && current?.warned !== version;
  const warned = warn ? version : current?.warned;
  const manifest: Manifest = { version, skills, status, ...(warned !== undefined && { warned }), profiles, ...(antigravity && { antigravity }) };
  const wroteManifest = writeManifest(manifestPath, manifest);
  return { installed: progress.changed || wroteManifest, version, skills, conflicts, warn };
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
  profiles[name] = ticked ? linkProfile(home, name, state, manifest.skills, false, conflicts, { changed: false }, new Set()) : unlinkProfile(home, name, state, removed);
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
 * Gives a profile a relative link per skill and a checklist copy that matches `~/.agents/references`, and removes
 * its links to skills no longer installed. A link that already points at the right skill folder is adopted, and an
 * engine link that points anywhere else is replaced. Any other path the engine didn't make is a conflict and stays,
 * except `references/`: with `adopt`, the engine replaces whatever is there with its checklist copy.
 * Each write sets `progress.changed`, and each skill whose engine link it puts back joins `putBack`.
 */
function linkProfile(
  home: string, name: string, state: ProfileState, skills: string[], adopt: boolean, conflicts: string[], progress: { changed: boolean },
  putBack: Set<string>,
): ProfileState {
  const folder = join(home, name, 'skills');
  const links = state.links.filter((skill) => skills.includes(skill));
  for (const skill of state.links) if (!links.includes(skill) && removeLink(join(folder, skill))) progress.changed = true;
  if (!exists(folder)) {
    mkdirSync(folder, { recursive: true });
    progress.changed = true;
  }
  for (const skill of skills) {
    const path = join(folder, skill);
    const target = join(home, '.agents/skills', skill);
    const made = links.includes(skill);
    if (exists(path)) {
      if (pointsAt(path, target)) {
        if (!made) links.push(skill);
        continue;
      }
      if (!made || !removeLink(path)) {
        conflicts.push(path);
        if (made) links.splice(links.indexOf(skill), 1);
        continue;
      }
    } else if (!made) links.push(skill);
    if (made) putBack.add(skill);
    symlinkSync(relative(folder, target), path);
    progress.changed = true;
  }

  const references = join(home, name, 'references');
  const ours = state.references || adopt || !exists(references);
  const source = join(home, '.agents/references');
  if (!ours) conflicts.push(references);
  else if (!sameTree(source, references)) swap(stage({ label: `references for ${name}`, source, target: references }), references, progress);
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
 * True when `target` holds what copying `source` would: the same file names, the same contents and the same
 * file modes, with no extra entry. A link in `source` counts as what it points at, as `stage` copies it.
 */
function sameTree(source: string, target: string): boolean {
  const from = statSync(source);
  let to;
  try { to = lstatSync(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  if (from.isDirectory()) {
    if (!to.isDirectory()) return false;
    const names = readdirSync(source).sort();
    const others = readdirSync(target).sort();
    return names.length === others.length && names.every((name, index) => name === others[index] && sameTree(join(source, name), join(target, name)));
  }
  return to.isFile() && from.mode === to.mode && from.size === to.size && readFileSync(source).equals(readFileSync(target));
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
  const antigravity = isRecord(manifest.antigravity) ? Object.fromEntries(Object.entries<unknown>(manifest.antigravity)
    .filter((entry): entry is [string, unknown[]] => ANTIGRAVITY_FOLDERS.includes(entry[0]) && Array.isArray(entry[1]))
    .map(([folder, names]) => [folder, names.filter(isFolderName)])) : undefined;
  return {
    version: manifest.version,
    skills: (Array.isArray(manifest.skills) ? manifest.skills : []).filter(isFolderName),
    ...(status && { status }),
    ...(typeof manifest.warned === 'string' && { warned: manifest.warned }),
    ...(profiles && { profiles }),
    ...(antigravity && { antigravity }),
  };
}

function isSkillStatus(value: unknown): value is SkillStatus {
  if (!isRecord(value)) return false;
  if (value.state === 'restored') return typeof value.restoredAt === 'string';
  return value.state === 'matching' || value.state === 'blocked';
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
