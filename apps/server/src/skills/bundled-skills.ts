// Reads the bundle's skills and checklists for Settings > Skills: each folder in skills/ and each checklist in
// references/, with its author, licence and source on GitHub. UPSTREAM.md's rows name each Copy's source, path and
// commit, and its Authors line each source's author and licence; a skill it doesn't list is Lar's own.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BundledSkill } from '@lar-factory/shared';

/** The checkout's root, which holds skills/, references/ and UPSTREAM.md as the app's bundle does. */
export const BUNDLE_URL = new URL('../../../../', import.meta.url);

/** BOARD_BUNDLE_DIR when set (the board app's bundle), else the checkout's root. */
export function bundleUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const dir = env.BOARD_BUNDLE_DIR;
  return dir ? pathToFileURL(join(dir, '/')) : BUNDLE_URL;
}

const LAR = { author: 'Lar', licence: 'MIT', repo: 'maddec01/lar-factory', commit: 'main' };

interface Copy { source: string; path: string; commit: string }

/** UPSTREAM.md's rows by Skill, and its Authors line by source. */
function parseUpstream(markdown: string) {
  const copies = new Map<string, Copy>();
  for (const [, name, source, path, commit] of markdown.matchAll(/^\| `([^`]+)` \| (\S+) \| `([^`]+)` \| `([0-9a-f]+)` \|/gm)) {
    copies.set(name!, { source: source!, path: path!, commit: commit! });
  }
  const authors = new Map<string, { author: string; licence: string }>();
  const line = /^Authors: (.*)$/m.exec(markdown)?.[1] ?? '';
  for (const [, source, author, licence] of line.matchAll(/(\S+\/\S+) by ([^(]+?) \(([^)]+)\)/g)) {
    authors.set(source!, { author: author!, licence: licence! });
  }
  return { copies, authors };
}

/** Every skill folder, then every checklist, sorted by name; `references/LICENSE` is no checklist. */
export function readBundledSkills(bundle: string): BundledSkill[] {
  const { copies, authors } = parseUpstream(readFileSync(join(bundle, 'UPSTREAM.md'), 'utf8'));
  // A skill is named by its folder and links to a tree; a checklist keeps its `references/` path and links to a blob.
  const names = (folder: string, kind: 'tree' | 'blob', keep: (entry: { name: string; isDirectory(): boolean }) => boolean) =>
    readdirSync(join(bundle, folder), { withFileTypes: true }).filter(keep).map((entry) => entry.name).sort().map((entry) => {
      const file = `${folder}/${entry}`;
      return { file, kind, name: kind === 'tree' ? entry : file };
    });
  const files = [
    ...names('skills', 'tree', (entry) => entry.isDirectory()),
    ...names('references', 'blob', (entry) => !entry.isDirectory() && entry.name.endsWith('.md')),
  ];
  return files.map(({ file, kind, name }) => {
    const copy = copies.get(name);
    if (!copy) return { name, author: LAR.author, licence: LAR.licence, source: `https://github.com/${LAR.repo}/${kind}/${LAR.commit}/${file}` };
    const credit = authors.get(copy.source) ?? { author: copy.source.split('/')[0]!, licence: 'Unknown licence' };
    return { name, ...credit, source: `https://github.com/${copy.source}/${kind}/${copy.commit}/${copy.path}` };
  });
}

/** The bundle's skills, or none when it can't be read, with the reason. */
export function loadBundledSkills(url: URL = bundleUrl()): { skills: BundledSkill[]; error?: string } {
  try {
    return { skills: readBundledSkills(fileURLToPath(url)) };
  } catch (error) {
    return { skills: [], error: error instanceof Error ? error.message : String(error) };
  }
}
