// The Azure DevOps sprint item source: reads one team's current sprint through az; azure-writes.ts writes its work items.

import { ReadProblem, type ItemSource } from '../items/item-source.ts';
import { az, azureItems, type Az } from './azure-items.ts';

/** What fixes a team with no current iteration, short of naming another team, which onboarding's Checks step does by going Back. */
export const SPRINT_FIX = 'Give the team a sprint whose dates cover today in its project settings';

/**
 * The current sprint of `team` in the project of `repos`, the Azure DevOps repositories reading it, each named
 * organization/project/repository as its origin URL has them, Completed items as Done.
 * `run` stands in for az in tests. No current iteration, a logged-out az and a missing azure-devops extension are each a
 * ReadProblem with its fix.
 */
export function azureSprint(repos: readonly string[], team: string, run: Az = az): ItemSource {
  return azureItems(repos, team, async ({ organization, project, boards, workItems, backlogIds }) => {
    const [iteration] = await boards<{ id: string; name: string }[]>(['list', '--timeframe', 'current']);
    if (!iteration) {
      throw new ReadProblem(`Team ${team} has no current iteration in ${organization}/${project}. `
        + `${SPRINT_FIX}, or Edit the repository in Settings › Repositories to name another team.`);
    }
    const listed = await boards<{ workItemRelations: { target: { id: number } }[] }>(['list-work-items', '--id', iteration.id]);
    const order = await backlogIds();
    const items = await workItems([...new Set(listed.workItemRelations.map((r) => r.target.id))]);
    return { title: `${team} ${iteration.name}`, items, order, childIds: items.map((raw) => raw.id), completed: true };
  }, run);
}
