// Shared contract for capturing an issue; no browser or Node dependencies.
import type { Item, RepoConfig } from './model.ts';

export const ITEM_KINDS = ['bug', 'feature', 'improvement'] as const;

export interface ItemDraft {
  repo: string;
  kind: (typeof ITEM_KINDS)[number];
  title: string;
  description: string;
  labels: string[];
  /** Only for <repo>: the new Azure work item is tagged for its repository, so no other repository's List shows it. */
  onlyFor?: true;
}

export interface CreationProgress {
  creationUncertain?: boolean;
  issue?: { number: number; node_id: string; html_url: string; updated_at: string };
  item?: Item;
}

export interface CreationResult {
  item: Item | null;
  issueUrl: string | null;
  error: string | null;
  uncertain?: boolean;
}

export function validateDraft(input: unknown, repos: RepoConfig[]): ItemDraft {
  if (!input || typeof input !== 'object') throw new Error('Enter the item details.');
  const value = input as Record<string, unknown>;
  const repo = repos.find((r) => r.repo === value.repo);
  if (!repo) throw new Error('Choose a configured repository.');
  if (!ITEM_KINDS.includes(value.kind as ItemDraft['kind'])) throw new Error('Choose bug, feature or improvement.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 256) {
    throw new Error('Enter a nonblank title of at most 256 characters.');
  }
  if (typeof value.description !== 'string' || value.description.length > 65_536) {
    throw new Error('Description must be text of at most 65,536 characters.');
  }
  const allowed = repo.labels;
  if (!Array.isArray(value.labels) || value.labels.length > allowed.length ||
    value.labels.some((l: unknown) => typeof l !== 'string' || !allowed.includes(l))) {
    throw new Error("Choose only the selected repository's custom labels.");
  }
  const azure = repo.items === 'sprint' || repo.items === 'backlog';
  if (value.onlyFor !== undefined && value.onlyFor !== false && (value.onlyFor !== true || !azure)) {
    throw new Error('Only an item on Azure DevOps can be only for its repository.');
  }
  return { repo: repo.repo, kind: value.kind as ItemDraft['kind'], title: value.title.trim(),
    description: value.description, labels: [...new Set(value.labels as string[])], ...value.onlyFor === true && { onlyFor: true as const } };
}
