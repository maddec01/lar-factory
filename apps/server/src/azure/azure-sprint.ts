// The Azure DevOps sprint item source: reads one team's current sprint through az; azure-writes.ts writes its work items.

import { type AzureCalls, type Listing } from './azure-items.ts';

/** Lists the current sprint, allowing an empty sprint only for the combined board. */
export async function readSprint(team: string, { boards, workItems, backlogIds }: AzureCalls): Promise<Listing> {
  const [iteration] = await boards<{ id: string; name: string }[]>(['list', '--timeframe', 'current']);
  if (!iteration) {
    return { title: team, items: [], completed: true };
  }
  const listed = await boards<{ workItemRelations: { target: { id: number } }[] }>(['list-work-items', '--id', iteration.id]);
  const order = await backlogIds();
  const items = await workItems([...new Set(listed.workItemRelations.map((r) => r.target.id))]);
  return { title: `${team} ${iteration.name}`, items, order, childIds: items.map((raw) => raw.id), completed: true };
}
