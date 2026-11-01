// Shared contract for Add item, which captures work or picks a ticket; no browser or Node dependencies.
import type { Item, Kind, RepoConfig } from './model.ts';
import { trackerCapabilities } from './tracker-capabilities.ts';

export const ITEM_KINDS = ['bug', 'feature', 'improvement'] as const;

/** New work keeps its title and original description, with an optional tracker ticket. */
export interface ItemDraft {
  repo: string;
  kind: (typeof ITEM_KINDS)[number];
  title: string;
  description: string;
  createIssue?: boolean;
  options?: TicketOptions;
}

/** Optional provider fields. Missing fields use only the repository's kind mapping. */
export interface TicketOptions {
  labels?: string[];
  /** Names typed for this ticket, created when it submits. A name the tracker has by then is used as it is. */
  newLabels?: string[];
  type?: string;
  assignee?: string;
  milestone?: string;
  iteration?: string;
}

export interface TicketCreationOptions {
  provider: 'github' | 'azure';
  labels: string[];
  /** Each label's colour, six hex digits, on a tracker whose labels have one. */
  labelColors?: Record<string, string>;
  types: string[];
  assignees: string[];
  milestones: { value: string; name: string }[];
  iterations: string[];
  problems: string[];
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

export function validateDraft(input: unknown, repos: RepoConfig[]): ItemDraft;
export function validateDraft<K extends string>(input: unknown, repos: RepoConfig[], kinds: readonly K[]): Omit<ItemDraft, 'kind'> & { kind: K };
export function validateDraft(input: unknown, repos: RepoConfig[], kinds: readonly string[] = ITEM_KINDS): Omit<ItemDraft, 'kind'> & { kind: string } {
  if (!input || typeof input !== 'object') throw new Error('Enter the item details.');
  const value = input as Record<string, unknown>;
  const repo = repos.find((r) => r.repo === value.repo);
  if (!repo) throw new Error('Choose a configured repository.');
  if (!kinds.includes(value.kind as string)) throw new Error(kinds === ITEM_KINDS ? 'Choose bug, feature or improvement.' : 'Choose a valid work kind.');
  if (typeof value.title !== 'string' || !value.title.trim() || /[\r\n]/.test(value.title) || value.title.length > 256) {
    throw new Error('Enter a nonblank title of at most 256 characters.');
  }
  if (typeof value.description !== 'string' || value.description.length > 65_536) {
    throw new Error('Description must be text of at most 65,536 characters.');
  }
  if (value.createIssue !== undefined && typeof value.createIssue !== 'boolean') throw new Error('Choose whether to create an issue.');
  let options: TicketOptions | undefined;
  if (value.options !== undefined) {
    if (!value.options || typeof value.options !== 'object' || Array.isArray(value.options)) throw new Error('Choose valid issue options.');
    const raw = value.options as Record<string, unknown>;
    if (Object.keys(raw).some(key => !['labels', 'newLabels', 'type', 'assignee', 'milestone', 'iteration'].includes(key))) throw new Error('Choose valid issue options.');
    if (raw.labels !== undefined && (!Array.isArray(raw.labels) || raw.labels.length > 100 || raw.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 256))) throw new Error('Choose valid labels.');
    if (raw.newLabels !== undefined) {
      if (!Array.isArray(raw.newLabels) || raw.newLabels.length > 100 || raw.newLabels.some(label => typeof label !== 'string')) throw new Error('Choose valid labels.');
      const problem = (raw.newLabels as string[]).map(trackerCapabilities(repo.repo).nameProblem).find(Boolean);
      if (problem) throw new Error(problem);
    }
    if (['type', 'assignee', 'milestone', 'iteration'].some(key => raw[key] !== undefined && (typeof raw[key] !== 'string' || (raw[key] as string).length > 512 || /[\r\n]/.test(raw[key] as string)))) throw new Error('Choose valid issue options.');
    if (raw.milestone && !/^[1-9]\d*$/.test(String(raw.milestone))) throw new Error('Choose a valid milestone.');
    options = raw as TicketOptions;
  }
  return { ...(value.createIssue === undefined ? {} : { createIssue: value.createIssue }), ...(options === undefined ? {} : { options }), repo: repo.repo, kind: value.kind as string, title: value.title.trim(), description: value.description };
}
