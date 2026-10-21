// Mirror only Claude's installed shared skills into existing extra profiles.
import { lstatSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

try {
  if (!process.env.HOME) throw new Error('HOME must name the account whose Claude profiles should be synchronized.');
  const home = realpathSync(process.env.HOME);
  const agents = join(home, '.agents/skills');
  const claude = join(home, '.claude/skills');
  const conflicts: string[] = [];
  let linked = 0;
  if (lstatIfPresent(agents) && lstatIfPresent(claude)) {
    const root = realpathSync(agents) + sep;
    const eligible: { name: string; target: string }[] = [];
    for (const entry of readdirSync(claude, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue;
      const path = join(claude, entry.name);
      try {
        const target = realpathSync(path);
        if (target.startsWith(root) && statSync(target).isDirectory()) eligible.push({ name: entry.name, target });
      } catch (error) {
        if (!['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
    for (const profile of readdirSync(home, { withFileTypes: true })) {
      if (!profile.isDirectory() || !profile.name.startsWith('.claude-')) continue;
      const directory = join(home, profile.name, 'skills');
      const folder = lstatIfPresent(directory);
      if (!folder) mkdirSync(directory);
      for (const { name, target } of eligible) {
        const destination = join(directory, name);
        if (folder && !folder.isDirectory()) { conflicts.push(destination); continue; }
        const current = lstatIfPresent(destination);
        if (current?.isSymbolicLink()) {
          try { if (realpathSync(destination) === target) continue; }
          catch { /* Preserve dangling and unrelated links as conflicts. */ }
        }
        if (current) conflicts.push(destination);
        else { symlinkSync(relative(directory, target), destination); linked++; }
      }
    }
  }
  console.log(`Claude profiles: created ${linked} relative skill links.`);
  if (conflicts.length) {
    for (const path of conflicts) console.error(`Skipped conflict: ${path}`);
    throw new Error(`Partial update: ${conflicts.length} conflicting destinations preserved. Resolve them manually and rerun.`);
  }
} catch (error) {
  console.error(`Skill synchronization failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
