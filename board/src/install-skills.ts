// Installs a bundle's skills and checklists into a home's ~/.agents, once per app version.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The manifest's file name in ~/.agents. The skills CLI owns .skill-lock.json, so this never touches it. */
export const INSTALL_MANIFEST = '.mux-factory-install.json';

export interface InstallResult {
  /** False when the manifest already named this version and nothing was copied. */
  installed: boolean;
  version: string;
  skills: string[];
}

interface Manifest {
  version: string;
  skills: string[];
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
 * A copy that fails leaves the previous files and manifest in place and throws an error naming it.
 * A failure before any file is replaced throws an `InstallError` whose `changed` is false.
 */
export function installSkills(home: string, bundle: string, version: string, options: { force?: boolean } = {}): InstallResult {
  const agents = join(home, '.agents');
  const manifestPath = join(agents, INSTALL_MANIFEST);
  const current = readManifest(manifestPath);
  if (current?.version === version && !options.force) return { installed: false, ...current };

  const skills = readdirSync(join(bundle, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const copies: Copy[] = [
    ...skills.map((name) => ({ label: `skill ${name}`, source: join(bundle, 'skills', name), target: join(agents, 'skills', name) })),
    { label: 'references', source: join(bundle, 'references'), target: join(agents, 'references') },
  ];

  const staged: { copy: Copy; temporary: string }[] = [];
  try {
    for (const copy of copies) staged.push({ copy, temporary: stage(copy) });
  } catch (error) {
    for (const { temporary } of staged) rmSync(temporary, { recursive: true, force: true });
    throw new InstallError((error as Error).message, false, { cause: error });
  }
  for (const { copy, temporary } of staged) swap(temporary, copy.target);

  const manifest: Manifest = { version, skills };
  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporaryManifest, manifestPath);
  return { installed: true, ...manifest };
}

/** Reads the manifest, or null when there is none. Names that aren't one folder name are dropped. */
function readManifest(path: string): Manifest | null {
  let manifest: Manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new InstallError(`Couldn't read ${path}: ${(error as Error).message}. Delete that file and start Mux Factory again.`, false, { cause: error });
  }
  return { ...manifest, skills: (Array.isArray(manifest.skills) ? manifest.skills : []).filter(isFolderName) };
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

/** Moves `temporary` into `target`'s place and deletes whatever was there. */
function swap(temporary: string, target: string): void {
  const previous = `${temporary}.previous`;
  try { renameSync(target, previous); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  renameSync(temporary, target);
  rmSync(previous, { recursive: true, force: true });
}
