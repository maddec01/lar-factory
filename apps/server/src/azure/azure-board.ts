// The team's open backlog together with its current sprint, each work item once.

import type { ItemSource } from '../items/item-source.ts';
import { readBacklog } from './azure-backlog.ts';
import { az, azureItems, linked, type Az } from './azure-items.ts';
import { readSprint } from './azure-sprint.ts';

export function azureBoard(repos: readonly string[], team: string, run: Az = az): ItemSource {
  return azureItems(repos, team, async (calls) => {
    let order: Promise<number[]> | undefined;
    const reads = { ...calls, backlogIds: () => order ??= calls.backlogIds() };
    const [backlog, sprint] = await Promise.all([readBacklog(team, reads), readSprint(team, reads)]);
    const sprintIds = new Set(sprint.items.map((item) => item.id));
    return {
      title: `${team} backlog and current sprint`,
      items: [...new Map([...backlog.items, ...sprint.items].map((item) => [item.id, item])).values()],
      order: backlog.order,
      childIds: [...sprint.childIds ?? [], ...backlog.items.filter((item) => !sprintIds.has(item.id))
        .flatMap((item) => linked(item, 'System.LinkTypes.Hierarchy-Forward'))],
      completed: sprintIds,
      ...sprint.currentSprint && { currentSprint: sprint.currentSprint },
    };
  }, run);
}
