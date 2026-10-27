// The Azure DevOps backlog item source: reads one team's requirement backlog through az, read only for now.

import type { ItemSource } from '../items/item-source.ts';
import { az, azureItems, field, linked, type Az, type RawWorkItem } from './azure-items.ts';

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
 * The open requirement-level work items on `team`'s backlog in the project of `repo`, an Azure DevOps repository named
 * organization/project/repository as its origin URL has them, in any sprint or none, each with its Tasks.
 * The backlog can list a parent from another team's area path, which the team field values leave out.
 * `run` stands in for az in tests. A logged-out az and a missing azure-devops extension are each a ReadProblem with its fix.
 */
export function azureBacklog(repo: string, team: string, run: Az = az): ItemSource {
  return azureItems(repo, team, async ({ invoke, workItems, backlog }) => {
    const route = [`team=${team}`];
    const [levels, areas] = await Promise.all([backlog, invoke<TeamFieldValues>('work', 'teamfieldvalues', route)]);
    const listed = await invoke<{ workItems: { target: { id: number } }[] }>('work', 'workitems', [...route, `backlogId=${levels.requirementBacklog.id}`]);
    const requirements = new Set(levels.requirementBacklog.workItemTypes.map((t) => t.name));
    const top = (await workItems([...new Set(listed.workItems.map((w) => w.target.id))]))
      .filter((raw) => requirements.has(field(raw, 'System.WorkItemType')) && owns(areas, raw));
    const tasks = await workItems([...new Set(top.flatMap((raw) => linked(raw, 'System.LinkTypes.Hierarchy-Forward')))]);
    return { title: `${team} backlog`, items: [...top, ...tasks], completed: false };
  }, run);
}
