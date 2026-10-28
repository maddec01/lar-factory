// The team's open backlog together with its current sprint, each work item once.

import type { ItemSource } from '../items/item-source.ts';
import { readBacklog } from './azure-backlog.ts';
import { az, azureItems, type Az } from './azure-items.ts';
import { readSprint } from './azure-sprint.ts';

export function azureBoard(repos: readonly string[], team: string, run: Az = az): ItemSource {
  return azureItems(repos, team, async (calls) => {
    const [backlog, sprint] = await Promise.all([readBacklog(team, calls), readSprint(team, calls)]);
    return {
      title: `${team} backlog and current sprint`,
      items: [...new Map([...backlog.items, ...sprint.items].map((item) => [item.id, item])).values()],
      completed: new Set(sprint.items.map((item) => item.id)),
    };
  }, run);
}
