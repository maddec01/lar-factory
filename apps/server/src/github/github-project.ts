// The GitHub Project item source: reads and writes the Project config.json names, through github.ts.

import type { BoardConfig } from '../config/config.ts';
import type { ItemSource } from '../items/item-source.ts';
import { abandonItem, addIssueLabel, addProjectItem, fetchProject, findProjectNumber, setIssueStatus, setItemStatus } from './github.ts';

export function githubProject(config: BoardConfig): ItemSource {
  // A read looks the number up by title once when config.json leaves it out; a write before then looks it up itself.
  let number = config.number;
  const project = (): BoardConfig => ({ ...config, number });
  return {
    async read() {
      number ??= await findProjectNumber(config.owner, config.title);
      return fetchProject(config.owner, number);
    },
    setStatus: (item, status) => setItemStatus(project(), item.id, status),
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label),
    create: (draft, progress) => addProjectItem(project(), draft, progress),
    setParentStatus: (parent, status) => setIssueStatus(project(), parent.url, status),
    abandon: (item) => abandonItem(project(), item),
  };
}
