// Reads the two bundled Lar skills, their included authors and install states for Settings.

import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BundledSkill } from '@lar-factory/shared';
import { readSkillStatus } from '@lar-factory/shared/install-skills';

/** The assembled development bundle at the checkout root. */
export const BUNDLE_URL = new URL('../../../../.assembled-skills/', import.meta.url);

/** BOARD_BUNDLE_DIR when set (the board app's bundle), else the checkout's root. */
export function bundleUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const dir = env.BOARD_BUNDLE_DIR;
  return dir ? pathToFileURL(join(dir, '/')) : BUNDLE_URL;
}

const LAR = { author: 'Lar', licence: 'MIT', repo: 'maddec01/lar-factory', commit: 'main' };

/** A Copy or Port: the upstream source it comes from and its repository path in lar. */
interface Upstream { source: string; path: string }

/** The cells, without backticks, of each row in the table whose header row starts with `header`. */
function tableRows(markdown: string, header: string): string[][] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(header));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && !line.startsWith('|'));
  return lines.slice(start + 2, end < 0 ? undefined : end).map((row) => row.split('|').slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, '')));
}

/** UPSTREAM.md's Copies and Ports, and its Authors line by source. */
function parseUpstream(markdown: string) {
  const included: Upstream[] = [
    ...tableRows(markdown, '| Skill | Source | Path | Repository path |').map(([, source, , path]) => ({ source: source!, path: path! })),
    ...tableRows(markdown, '| Port | Source | Path | Sections |').map(([path, source]) => ({ source: source!, path: path! })),
  ];
  const authors = new Map<string, { author: string; licence: string }>();
  const line = /^Authors: (.*)$/m.exec(markdown)?.[1] ?? '';
  for (const [, source, author, licence] of line.matchAll(/(\S+\/\S+) by ([^(]+?) \(([^)]+)\)/g)) {
    authors.set(source!, { author: author!, licence: licence! });
  }
  return { included, authors };
}

/** The two installed skills, credited to Lar and the authors of the Copies and Ports they include. */
export function readBundledSkills(bundle: string): BundledSkill[] {
  const { included, authors } = parseUpstream(readFileSync(join(bundle, 'UPSTREAM.md'), 'utf8'));
  return ['lar-shape', 'lar-build'].map((name) => ({
    name, author: LAR.author, licence: LAR.licence,
    source: `https://github.com/${LAR.repo}/tree/main/skills/${name}`,
    includedAuthors: [...new Set(included.filter((file) => file.path.startsWith(`skills/${name}/`) || file.path.startsWith('skills/shared/')).map((file) => authors.get(file.source)?.author ?? file.source.split('/')[0]!))].sort(),
    notices: `https://github.com/${LAR.repo}/blob/main/THIRD_PARTY_NOTICES.md`,
  }));
}

/** The names of the bundle's skills, which are its folders in skills/. */
export function bundledSkillNames(url: URL = bundleUrl()): string[] {
  return readdirSync(join(fileURLToPath(url), 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** The home the board app installs skills into: LAR_FACTORY_INSTALL_ROOT when set, else the user's home. */
export function installHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.LAR_FACTORY_INSTALL_ROOT || home;
}

/** `skills` with each skill's state from the install manifest in `home`; unchanged when there is none or it can't be read. */
export function withInstallState(skills: BundledSkill[], home: string): BundledSkill[] {
  let status;
  try { status = readSkillStatus(home); }
  catch { return skills; }
  return skills.map((skill) => status?.[skill.name] ? { ...skill, status: status[skill.name] } : skill);
}

/** The bundle's skills, or none when it can't be read, with the reason. */
export function loadBundledSkills(url: URL = bundleUrl()): { skills: BundledSkill[]; error?: string } {
  try {
    return { skills: readBundledSkills(fileURLToPath(url)) };
  } catch (error) {
    return { skills: [], error: error instanceof Error ? error.message : String(error) };
  }
}
