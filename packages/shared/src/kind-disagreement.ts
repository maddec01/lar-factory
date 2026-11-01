// Whether an item's kind and its ticket's disagree, for rows, item details and lar-work. A ticket carrying the item's kind
// agrees, whichever other name trackerKind would read first, so this reads the mappings and never trackerKind alone.
import type { OperationAccess, RepositoryOperation } from './model.ts';
import { SWAP_KINDS, kindLabelSwap, kindLabels, kindNames, sameLabel } from './managed-labels.ts';
import type { SwapKind } from './managed-labels.ts';
import type { EffectiveVocabulary } from './vocabulary.ts';
import { writeAccessProblem } from './write-access.ts';

/** What a ticket says about its kind. */
export interface TicketKindFacts {
  labels: readonly string[];
  type: string | null;
}

/** What giving a ticket a kind changes on it. */
export interface KindTicketSwap {
  add: string[];
  remove: string[];
  type: { from: string | null; to: string } | null;
}

export interface KindDisagreement {
  /** What the ticket says, or null when it has no recognised kind. */
  ticketKind: SwapKind | null;
  /** The side that moved from the kind they last agreed on. A record with no agreed kind counts as the item having changed. */
  changed: 'item' | 'ticket';
  /** Whether the user chose to keep both as they are, for these two kinds. */
  kept: boolean;
  /** What giving the ticket the item's kind changes on it. */
  swap: KindTicketSwap;
}

const isSwapKind = (kind: string): kind is SwapKind => (SWAP_KINDS as readonly string[]).includes(kind);

/** The labels and type a repository maps to `kind`, in lower case. */
const mappedNames = (kind: SwapKind, vocabulary?: EffectiveVocabulary): string[] =>
  [...kindLabels(kind, vocabulary), ...vocabulary?.[kind].type ? [vocabulary[kind].type.toLowerCase()] : []];

/** The kind `ticket` says, for an item of `itemKind`: that kind if it carries it, or the first it carries, mappings before names. */
export function ticketKindOf(itemKind: string, { labels, type }: TicketKindFacts, vocabulary?: EffectiveVocabulary): SwapKind | null {
  const names = [...labels, ...type ? [type] : []].map((name) => name.toLowerCase());
  const carries = (wanted: readonly string[]) => wanted.some((name) => names.includes(name));
  if (isSwapKind(itemKind) && (carries(mappedNames(itemKind, vocabulary)) || carries(kindNames(itemKind)))) return itemKind;
  return SWAP_KINDS.find((kind) => carries(mappedNames(kind, vocabulary))) ?? SWAP_KINDS.find((kind) => carries(kindNames(kind))) ?? null;
}

/** What giving `ticket` the kind `kind` changes on it. A kind with no mapped type leaves its type alone. */
export function kindTicketSwap(ticket: TicketKindFacts, kind: SwapKind, vocabulary?: EffectiveVocabulary): KindTicketSwap {
  const to = vocabulary?.[kind].type ?? null;
  return { ...kindLabelSwap(ticket.labels, kind, vocabulary), type: to !== null && !(ticket.type !== null && sameLabel(ticket.type, to)) ? { from: ticket.type, to } : null };
}

/** Why this login can't make `swap`, or null when it can. It needs access only for what it writes. */
export function kindSwapAccessProblem(repo: string, swap: KindTicketSwap, access: Partial<Record<RepositoryOperation, OperationAccess>>,
  safety: { azureReadOnly?: boolean | undefined } = {}): string | null {
  const options = safety.azureReadOnly === undefined ? {} : { azureReadOnly: safety.azureReadOnly };
  return (swap.add.length || swap.remove.length ? writeAccessProblem(repo, 'tag-ticket', access, options) : null)
    ?? (swap.type ? writeAccessProblem(repo, 'type-ticket', access, options) : null);
}

/**
 * The record's disagreement with `ticket`, or null when there is none to show: they agree, an update answer covers these two
 * kinds, the record isn't a Bug, Feature or Improvement, or the ticket has no kind and the item's has nothing mapped to add.
 */
export function kindDisagreement(
  record: { kind: string; agreedTicketKind: string | null; kindAnswer: { answer: string; itemKind: string; ticketKind: string | null } | null },
  ticket: TicketKindFacts, vocabulary?: EffectiveVocabulary,
): KindDisagreement | null {
  const { kind, agreedTicketKind, kindAnswer } = record;
  if (!isSwapKind(kind)) return null;
  const ticketKind = ticketKindOf(kind, ticket, vocabulary);
  if (ticketKind === kind || (ticketKind === null && mappedNames(kind, vocabulary).length === 0)) return null;
  const answered = kindAnswer?.itemKind === kind && kindAnswer.ticketKind === ticketKind ? kindAnswer.answer : null;
  if (answered === 'update') return null;
  return {
    ticketKind,
    changed: ticketKind !== null && agreedTicketKind !== null && ticketKind !== agreedTicketKind ? 'ticket' : 'item',
    kept: answered === 'keep',
    swap: kindTicketSwap(ticket, kind, vocabulary),
  };
}
