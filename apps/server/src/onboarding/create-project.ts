// Creates a T3 project for onboarding's T3 project step: runs `t3 project add` on a folder on this Mac, then finds the
// new project among T3's projects, so the step can pick it.

import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ProjectChoice } from '@lar-factory/shared';
import { addProject } from '../t3/t3.ts';
import { expandHome } from '../t3/t3-settings.ts';

/** The path a folder resolves to, following links; the path itself when it can't be resolved. */
function realFolder(folder: string): string {
  try { return realpathSync(folder); }
  catch { return folder; }
}

/**
 * Adds the body's `folder` (a full path, `~` for the home) as a T3 project and returns T3's projects as `choices` lists
 * them, with the new project's id; or the status and problem when the folder is refused, t3 fails or T3 doesn't list it.
 */
export async function createProject(input: Record<string, unknown>, choices: () => Promise<ProjectChoice[]>,
  env: NodeJS.ProcessEnv = process.env, add: (folder: string) => Promise<string | null> = addProject,
): Promise<{ projects: ProjectChoice[]; projectId: string } | { status: number; error: string }> {
  const named = typeof input.folder === 'string' ? input.folder.trim() : '';
  if (!named) return { status: 400, error: 'Name the folder to add.' };
  if (!isAbsolute(named) && named !== '~' && !named.startsWith('~/')) {
    return { status: 400, error: 'Give the folder\'s full path, such as ~/Developer/lar-web.' };
  }
  const folder = resolve(expandHome(named, env.HOME ?? ''));
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return { status: 400, error: `There is no folder at ${folder}.` };
  const failed = await add(folder);
  if (failed) return { status: 502, error: failed };
  let projects: ProjectChoice[];
  try { projects = await choices(); }
  catch (err) { return { status: 502, error: err instanceof Error ? err.message : String(err) }; }
  const real = realFolder(folder);
  const created = projects.find((p) => realFolder(p.folder) === real);
  return created ? { projects, projectId: created.id } : { status: 502, error: `T3 Code added ${folder}, but its projects don't list it.` };
}
