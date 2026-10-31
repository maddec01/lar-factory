// Shared contract for Add item, which captures work or picks a ticket; no browser or Node dependencies.
import type { Item, Kind, RepoConfig } from './model.ts';

export const ITEM_KINDS = ['bug', 'feature', 'improvement'] as const;

/** Work to capture: a ticketless work record with this title, and the description as its initial context. */
export interface ItemDraft {
  repo: string;
  kind: (typeof ITEM_KINDS)[number];
  title: string;
  description: string;
}

/** One of a repository's open tickets, as the ticket picker lists it. */
export interface TicketMatch {
  number: number;
  title: string;
  url: string;
  /** The work ID of the record already holding the ticket; absent while none does. */
  workId?: string;
}

/** An open ticket as a pick or an attach reads it: its text becomes a picked record's initial context. */
export interface PickedTicket extends TicketMatch {
  text: string;
  kind: Kind;
  tracker?: import('./tracker-structure.ts').TrackerStructure;
}

/** What capture and pick answer: the item the record shows as, or the error. */
export interface CreationResult {
  item: Item | null;
  error: string | null;
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
  return { repo: repo.repo, kind: value.kind as ItemDraft['kind'], title: value.title.trim(), description: value.description };
}
