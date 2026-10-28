// Reads one team's current sprint for its combined Azure board.

import { type AzureCalls, type Listing } from './azure-items.ts';

/** Lists the current sprint, or no items when the team has no current sprint. */
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
