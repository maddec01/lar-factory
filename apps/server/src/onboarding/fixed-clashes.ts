// Onboarding's fixed checks for known Clashes, read from the repository's default branch through gh or az with no
// checkout: an old CONTEXT.md, Matt Pocock's .scratch/ tracker, and each project skill named like a bundled skill. A
// multi-context repository's GLOSSARY-MAP.md is the factory's layout, so it raises nothing.

import { onAzure, type Clash, type FixedClashes, type SkillClash } from '@lar-factory/shared';
import { AZURE_REPOS } from '../azure/azure-repos.ts';
import { isRepo } from '../config/repository-config.ts';
import { defaultBranchFiles, message } from '../github/github.ts';
import { bundledSkillNames } from '../skills/bundled-skills.ts';

/** Each agent's project skill folder, as #351's findings list them. */
const PROJECT_SKILL_DIRS = ['.claude/skills', '.agents/skills', '.cursor/skills', '.codex/skills', '.opencode/skills', '.grok/skills', '.pi/skills'];

function contextClash(files: Set<string>): Clash | null {
  if (!files.has('CONTEXT.md')) return null;
  if (files.has('GLOSSARY.md')) {
    return { id: 'context', file: 'CONTEXT.md', ticked: false, edit: { kind: 'delete' },
      reason: "The factory's domain docs read GLOSSARY.md, which the repository has, so nothing reads CONTEXT.md." };
  }
  return { id: 'context', file: 'CONTEXT.md', ticked: true, edit: { kind: 'rename', to: 'GLOSSARY.md' },
    reason: "The factory's domain docs read GLOSSARY.md, and CONTEXT.md is its old name." };
}

function scratchClash(files: string[]): Clash | null {
  const count = files.filter((file) => file.startsWith('.scratch/')).length;
  if (!count) return null;
  return { id: 'scratch', file: '.scratch/', ticked: false, edit: { kind: 'delete' },
    reason: `.scratch/ holds ${count} ${count === 1 ? 'file' : 'files'} from Matt Pocock's local tracker. The factory tracks work on GitHub, so delete it once its tickets are moved.` };
}

/** Each project skill, a folder with a SKILL.md in an agent's project skill folder, by its path. */
export function projectSkills(files: string[]): SkillClash[] {
  return files.flatMap((file) => {
    const dir = PROJECT_SKILL_DIRS.find((d) => file.startsWith(`${d}/`));
    const name = dir && /^([^/]+)\/SKILL\.md$/.exec(file.slice(dir.length + 1))?.[1];
    return name ? [{ name, path: `${dir}/${name}/` }] : [];
  });
}

/** Runs the fixed checks on the body's `repo`, or gives the status and problem when gh, az or the bundle can't be read. */
export async function findFixedClashes(input: Record<string, unknown>, run?: (args: string[]) => Promise<string>,
  bundled: () => string[] = bundledSkillNames): Promise<FixedClashes | { status: number; error: string }> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository to check.' };
  let names;
  try { names = new Set(bundled().map((name) => name.toLowerCase())); }
  catch (err) { return { status: 500, error: `Can't read the app's bundled skills: ${message(err)}` }; }
  let files;
  try { files = await (onAzure(repo) ? AZURE_REPOS.defaultBranchFiles : defaultBranchFiles)(repo, run); }
  catch (err) { return { status: 502, error: `Can't read ${repo}'s default branch: ${message(err)}` }; }
  const skills = projectSkills(files);
  return {
    clashes: [contextClash(new Set(files)), scratchClash(files)].filter((clash) => clash !== null),
    skillClashes: skills.filter((skill) => names.has(skill.name.toLowerCase())).sort((a, b) => a.path.localeCompare(b.path)),
    projectSkills: [...new Set(skills.map((skill) => skill.name))].sort(),
  };
}
