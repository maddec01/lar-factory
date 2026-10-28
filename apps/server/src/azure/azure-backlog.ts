// Reads one team's requirement backlog for its combined Azure board.

import { field, type AzureCalls, type Listing, type RawWorkItem } from './azure-items.ts';

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

/** Lists the team backlog for the combined Azure board. */
export async function readBacklog(team: string, { invoke, workItems, backlog, backlogIds }: AzureCalls): Promise<Listing> {
  const route = [`team=${team}`];
  const [levels, areas] = await Promise.all([backlog, invoke<TeamFieldValues>('work', 'teamfieldvalues', route)]);
  const ids = await backlogIds();
  const requirements = new Set(levels.requirementBacklog.workItemTypes.map((t) => t.name));
  const top = (await workItems(ids))
    .filter((raw) => requirements.has(field(raw, 'System.WorkItemType')) && owns(areas, raw));
  return { title: `${team} backlog`, items: top, order: ids, completed: false };
}
