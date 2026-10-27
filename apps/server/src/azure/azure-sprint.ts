// The Azure DevOps sprint item source: reads one team's current sprint through az, read only for now.

import { ReadProblem, type ItemSource } from '../items/item-source.ts';
import { az, azureItems, type Az } from './azure-items.ts';

/**
 * The current sprint of `team` in the project of `repo`, an Azure DevOps repository named organization/project/repository
 * as its origin URL has them, Completed items as Done.
 * `run` stands in for az in tests. No current iteration, a logged-out az and a missing azure-devops extension are each a
 * ReadProblem with its fix.
 */
export function azureSprint(repo: string, team: string, run: Az = az): ItemSource {
  return azureItems(repo, team, async ({ organization, project, boards, workItems }) => {
    const [iteration] = await boards<{ id: string; name: string }[]>(['list', '--timeframe', 'current']);
    if (!iteration) {
      throw new ReadProblem(`Team ${team} has no current iteration in ${organization}/${project}. `
        + 'Give the team a sprint whose dates cover today in its project settings, or Edit the repository in Settings › Repositories to name another team.');
    }
    const listed = await boards<{ workItemRelations: { target: { id: number } }[] }>(['list-work-items', '--id', iteration.id]);
    const items = await workItems([...new Set(listed.workItemRelations.map((r) => r.target.id))]);
    return { title: `${team} ${iteration.name}`, items, completed: true };
  }, run);
}
