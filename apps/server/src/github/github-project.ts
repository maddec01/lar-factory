// The GitHub Project item source: reads and writes the Project config.json names, through github.ts.

import type { BoardConfig } from '../config/config.ts';
import { DONE_REFUSED, type ItemSource } from '../items/item-source.ts';
import type { ProjectCreationProgress } from './github.ts';
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
      if (status === 'Done') return DONE_REFUSED;
      const projectItemId = projectItemIds.get(item.id);
      return projectItemId ? setItemStatus(project(), projectItemId, status) : `Could not set ${status}. The board has not read this item from the project.`;
    },
    statusRefusal: () => null,
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label),
    async create(draft, shared) {
      // The Project item id rides on Add item's progress object, so a retry reuses it, but only this adapter reads it.
      const progress: ProjectCreationProgress = shared;
      const result = await addProjectItem(project(), draft, progress);
      if (result.item && progress.projectItemId) projectItemIds.set(result.item.id, progress.projectItemId);
      return result;
    },
    setParentStatus: async (parent, status) => (status === 'Done' ? DONE_REFUSED : setIssueStatus(project(), parent.url, status)),
    abandon: (item) => abandonItem(project(), item, projectItemIds.get(item.id)),
    renamedId: (savedId) => [...projectItemIds].find(([, projectItemId]) => projectItemId === savedId)?.[0],
  };
}
