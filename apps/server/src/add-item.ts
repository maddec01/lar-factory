// Shared contract for capturing an issue; no browser or Node dependencies.
import type { Item, RepoConfig } from './model.ts';

export const ITEM_KINDS = ['bug', 'feature', 'improvement'] as const;

export function applicability(platform: string): { title: string; hint: string; labels: string[] }[] {
  if (platform === 'Apple') return [
    { title: 'Apps', hint: 'No apps selected means all apps.', labels: ['app: music', 'app: video', 'app: photos', 'app: books'] },
    { title: 'Operating systems', hint: 'No OSes selected means all OSes.', labels: ['os: ios', 'os: macos', 'os: tvos', 'os: watchos'] },
  ];
  if (platform === 'Server') return [
    { title: 'Areas', hint: 'Selecting neither means both server and web.', labels: ['area: server', 'area: web'] },
  ];
  return [];
}

export interface ItemDraft {
  repo: string;
  kind: (typeof ITEM_KINDS)[number];
  title: string;
  description: string;
  labels: string[];
}

export interface CreationProgress {
  creationUncertain?: boolean;
  issue?: { number: number; html_url: string; updated_at: string };
  itemId?: string;
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
  const allowed = applicability(repo.platform).flatMap((g) => g.labels);
  if (!Array.isArray(value.labels) || value.labels.length > allowed.length ||
    value.labels.some((l: unknown) => typeof l !== 'string' || !allowed.includes(l))) {
    throw new Error('Choose applicability labels for the selected repository.');
  }
  return { repo: repo.repo, kind: value.kind as ItemDraft['kind'], title: value.title.trim(),
    description: value.description, labels: [...new Set(value.labels as string[])] };
}
