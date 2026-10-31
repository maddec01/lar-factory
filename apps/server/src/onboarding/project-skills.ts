// The project skills in a repository's file list: each folder with a SKILL.md in an agent's project skill folder,
// which onboarding offers to select and the Edit PR keeps or drops.

import type { SkillClash } from '@lar-factory/shared';

/** Each agent's project skill folder, as #351's findings list them. */
const PROJECT_SKILL_DIRS = ['.claude/skills', '.agents/skills', '.cursor/skills', '.codex/skills', '.opencode/skills', '.grok/skills', '.pi/skills'];

/** Each project skill, a folder with a SKILL.md in an agent's project skill folder, by its path. */
export function projectSkills(files: string[]): SkillClash[] {
  return files.flatMap((file) => {
    const dir = PROJECT_SKILL_DIRS.find((d) => file.startsWith(`${d}/`));
    const name = dir && /^([^/]+)\/SKILL\.md$/.exec(file.slice(dir.length + 1))?.[1];
    return name ? [{ name, path: `${dir}/${name}/` }] : [];
  });
}
