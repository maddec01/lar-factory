// The GitHub Project item source: reads and writes the Project a repository's .lar-factory.json names, through github.ts.

import { DONE_REFUSED, type ItemSource } from '../items/item-source.ts';
import type { GithubProjectRef, ProjectCreationProgress } from './github.ts';
import { abandonItem, addIssueLabel, addProjectItem, fetchProject, fetchProjectItems, setIssueStatus, setItemStatus } from './github.ts';

export function githubProject(project: GithubProjectRef): ItemSource {
  // Each item's Project item id by its Item.id, from the last read and from Add item since. Nothing outside this file sees one.
  let projectItemIds = new Map<string, string>();
  return {
    name: `Project ${project.owner}/${project.number}`,
    async read() {
      const { projectItemIds: read, ...items } = await fetchProject(project.owner, project.number);
      projectItemIds = read;
      return items;
    },
    async readSome(items) {
      const ids = items.flatMap((item) => projectItemIds.get(item.id) ?? []);
      const { items: read, projectItemIds: found } = await fetchProjectItems(ids);
      for (const [id, projectItemId] of found) projectItemIds.set(id, projectItemId);
      return read;
    },
    async setStatus(item, status) {
      if (status === 'Done') return DONE_REFUSED;
      const projectItemId = projectItemIds.get(item.id);
      return projectItemId ? setItemStatus(project, projectItemId, status) : `Could not set ${status}. The board has not read this item from the project.`;
    },
    statusRefusal: () => null,
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label),
    async create(draft, shared) {
      // The Project item id rides on Add item's progress object, so a retry reuses it, but only this adapter reads it.
      const progress: ProjectCreationProgress = shared;
      const result = await addProjectItem(project, draft, progress);
      if (result.item && progress.projectItemId) projectItemIds.set(result.item.id, progress.projectItemId);
      return result;
    },
    setParentStatus: async (parent, status) => (status === 'Done' ? DONE_REFUSED : setIssueStatus(project, parent.url, status)),
    abandon: (item) => abandonItem(project, item, projectItemIds.get(item.id)),
    renamedId: (savedId) => [...projectItemIds].find(([, projectItemId]) => projectItemId === savedId)?.[0],
  };
}
