import { liveProjects } from '../src/t3/t3-db.ts';
import { statsDbPath } from '../src/t3/t3-settings.ts';
import type { ProjectRead } from '../src/t3/project-protocol.ts';

export async function repositoryProjects(env: NodeJS.ProcessEnv = process.env): Promise<ProjectRead> {
  try {
    return { availability: 'available', observation: {
      observedAt: new Date().toISOString(),
      projects: liveProjects(statsDbPath(env), env.HOME ?? '').map(p => ({ id: p.id, title: p.title, workspaceRoot: p.folder })),
    } };
  } catch { return { availability: 'unavailable' }; }
}
