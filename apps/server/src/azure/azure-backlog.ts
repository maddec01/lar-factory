// The Azure DevOps backlog item source: reads one team's requirement backlog through az; azure-writes.ts writes its work items.

import type { ItemSource } from '../items/item-source.ts';
import { az, azureItems, field, type Az, type AzureCalls, type Listing, type RawWorkItem } from './azure-items.ts';

/** The field that places a work item in a team, System.AreaPath unless the project says otherwise, and the team's values of it. */
interface TeamFieldValues {
  field: { referenceName: string };
  values: { value: string; includeChildren: boolean }[];
}

/** Whether the work item sits under one of the team's values, or under one's children when it includes them. */
function owns({ field: { referenceName }, values }: TeamFieldValues, raw: RawWorkItem): boolean {
  // Area paths ignore case.
  const path = field(raw, referenceName).toLowerCase();
  return values.some(({ value, includeChildren }) =>
    path === value.toLowerCase() || (includeChildren && path.startsWith(`${value.toLowerCase()}\\`)));
}

/**
 * The open requirement-level work items on `team`'s backlog in the project of `repos`, the Azure DevOps repositories reading it,
 * each named organization/project/repository as its origin URL has them, in any sprint or none, each with its Tasks.
 * The backlog can list a parent from another team's area path, which the team field values leave out.
 * `run` stands in for az in tests. A logged-out az and a missing azure-devops extension are each a ReadProblem with its fix.
 */
export function azureBacklog(repos: readonly string[], team: string, run: Az = az): ItemSource {
  return azureItems(repos, team, (calls) => readBacklog(team, calls), run);
}

/** Lists the team backlog for both the backlog and combined board sources. */
export async function readBacklog(team: string, { invoke, workItems, backlog, backlogIds }: AzureCalls): Promise<Listing> {
  const route = [`team=${team}`];
  const [levels, areas] = await Promise.all([backlog, invoke<TeamFieldValues>('work', 'teamfieldvalues', route)]);
  const ids = await backlogIds();
  const requirements = new Set(levels.requirementBacklog.workItemTypes.map((t) => t.name));
  const top = (await workItems(ids))
    .filter((raw) => requirements.has(field(raw, 'System.WorkItemType')) && owns(areas, raw));
  return { title: `${team} backlog`, items: top, order: ids, completed: false };
}
