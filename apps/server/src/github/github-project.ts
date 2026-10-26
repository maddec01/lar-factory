// The GitHub Project item source: reads and writes the Project config.json names, through github.ts.

import type { BoardConfig } from '../config/config.ts';
import type { ItemSource } from '../items/item-source.ts';
import { abandonItem, addIssueLabel, addProjectItem, fetchProject, findProjectNumber, setIssueStatus, setItemStatus } from './github.ts';

export function githubProject(config: BoardConfig): ItemSource {
  // A read looks the number up by title once when config.json leaves it out; a write before then looks it up itself.
  let number = config.number;
  const project = (): BoardConfig => ({ ...config, number });
  // Each item's Project item id by its Item.id, from the last read and from Add item since. Nothing outside this file sees one.
  let projectItemIds = new Map<string, string>();
  return {
    async read() {
      number ??= await findProjectNumber(config.owner, config.title);
      const { projectItemIds: read, ...items } = await fetchProject(config.owner, number);
      projectItemIds = read;
      return items;
    },
    async setStatus(item, status) {
      const projectItemId = projectItemIds.get(item.id);
      return projectItemId ? setItemStatus(project(), projectItemId, status) : `Could not set ${status}. The board has not read this item from the project.`;
    },
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label),
    async create(draft, progress) {
      const result = await addProjectItem(project(), draft, progress);
      if (result.item && progress.itemId) projectItemIds.set(result.item.id, progress.itemId);
      return result;
    },
    setParentStatus: (parent, status) => setIssueStatus(project(), parent.url, status),
    abandon: (item) => abandonItem(project(), item, projectItemIds.get(item.id)),
    renamedId: (savedId) => [...projectItemIds].find(([, projectItemId]) => projectItemId === savedId)?.[0],
  };
}
