// Add item's commands: capture work as a ticketless work record, search a repository's open tickets, pick one into a
// record, and attach a ticket to captured work. Only these put work on the board, and none writes to a ticket: a
// picked ticket's text becomes its record's initial context, and later ticket edits never overwrite it.

import { validateDraft, type ItemDraft, type RepoConfig, type TicketMatch } from '@lar-factory/shared';
import { WorkRecordError, type WorkRecord, type WorkRecords } from '@lar-factory/work-records';
import type { BoardState } from '../board/board-state.ts';
import type { Reply } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';

export interface Capture {
  /** Records the work a submission describes, once per request ID. */
  capture(input: Record<string, unknown>): Promise<Reply>;
  /** The repository's open tickets matching the query, each with the work ID of the record holding it, if one does. */
  searchTickets(input: Record<string, unknown>): Promise<Reply>;
  /** Records the picked ticket, or opens the record already holding it, restoring it when set aside. */
  pick(input: Record<string, unknown>): Promise<Reply>;
  /** Gives captured work its ticket; the work ID stays. */
  attachTicket(itemId: string, number: unknown): Promise<Reply>;
}

export interface CaptureDeps {
  board: BoardState;
  /** Where the commands search and read tickets. */
  items: ItemSource;
  /** Where the commands record work; null in sample mode, which records nothing. */
  records: WorkRecords | null;
  /** Shows the work records as they are now. */
  reread(): void;
  /** The onboarded repositories as the last read found them. */
  repos(): RepoConfig[];
}

const REQUEST_ID = /^[a-f0-9-]{36}$/;
const NO_RECORDS = 'The board has no work records to add to.';
const REFUSED = new Set(['ticket-taken', 'stale-revision', 'not-found', 'invalid']);

const reply = (status: number, body: object): Reply => ({ status, body });
const failed = (err: unknown): Reply =>
  reply(err instanceof WorkRecordError && REFUSED.has(err.code) ? 409 : 502, { error: (err as Error).message });
const isTicketNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export function createCapture({ board, items, records, reread, repos }: CaptureDeps): Capture {
  /** Each submission's draft and the work ID it recorded, so a resent one records nothing more. */
  const submissions = new Map<string, { draft: ItemDraft; workId: string }>();
  const withBoard = (status: number, body: object): Reply => reply(status, { ...body, board: board.snapshot() });
  const repoOf = (value: unknown) => repos().find((r) => r.repo === value);
  /** The repository's records by ticket, `owner/name#12` in lower case. */
  const holders = (repo: string) =>
    new Map(records!.list({ repository: repo }).flatMap((r): [string, WorkRecord][] => (r.ticket ? [[r.ticket.toLowerCase(), r]] : [])));
  /** The record as the board shows it now. */
  const shown = (workId: string, extra: object = {}) => {
    reread();
    return withBoard(200, { item: board.find(workId) ?? null, error: null, ...extra });
  };

  return {
    async capture(input) {
      if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
        return reply(400, { error: 'The submission needs a valid request ID.' });
      }
      let draft: ItemDraft;
      try { draft = validateDraft(input.draft, repos()); }
      catch (err) { return reply(422, { error: (err as Error).message }); }
      if (!records) return reply(409, { error: NO_RECORDS });
      const entry = submissions.get(input.requestId);
      if (entry && JSON.stringify(entry.draft) !== JSON.stringify(draft)) {
        return reply(409, { error: 'This submission already belongs to another item. Finish it before starting a new one.' });
      }
      if (entry) return shown(entry.workId);
      if (submissions.size >= 1000) return reply(503, { error: 'The board has reached its submission limit. Restart the board.' });
      try {
        const { workId } = records.create({ title: draft.title, context: draft.description, repository: draft.repo, kind: draft.kind });
        submissions.set(input.requestId, { draft, workId });
        return shown(workId);
      } catch (err) { return failed(err); }
    },

    async searchTickets(input) {
      const repo = repoOf(input.repo);
      if (!repo) return reply(422, { error: 'Choose a configured repository.' });
      if (typeof input.query !== 'string' || input.query.length > 256) return reply(422, { error: 'Search with text of at most 256 characters.' });
      let found: TicketMatch[];
      try { found = await items.searchTickets(repo.repo, input.query); }
      catch (err) { return reply(502, { error: `Could not search ${repo.repo}'s tickets. ${(err as Error).message}` }); }
      const held = records ? holders(repo.repo) : new Map<string, WorkRecord>();
      const tickets = found.map((t) => {
        const holder = held.get(`${repo.repo}#${t.number}`.toLowerCase());
        return holder ? { ...t, workId: holder.workId } : t;
      });
      return reply(200, { tickets, error: null });
    },

    async pick(input) {
      const repo = repoOf(input.repo);
      if (!repo) return reply(422, { error: 'Choose a configured repository.' });
      if (!isTicketNumber(input.number)) return reply(422, { error: 'Pick one of the tickets the search found.' });
      if (!records) return reply(409, { error: NO_RECORDS });
      const ticket = `${repo.repo}#${input.number}`;
      try {
        const held = holders(repo.repo).get(ticket.toLowerCase());
        if (held) {
          if (held.setAside) records.restore(held.workId, held.revision);
          return shown(held.workId, { created: false });
        }
      } catch (err) { return failed(err); }
      let read;
      try { read = await items.readTicket(repo.repo, input.number); }
      catch (err) { return withBoard(502, { error: `Could not read ${ticket}. ${(err as Error).message}` }); }
      if (!read) return withBoard(404, { error: `${repo.repo} has no open ticket #${input.number}.` });
      try {
        const { record, created } = records.importTicket({ title: read.title, context: read.text, repository: repo.repo, kind: read.kind, ticket });
        return shown(record.workId, { created });
      } catch (err) { return failed(err); }
    },

    async attachTicket(itemId, number) {
      const item = board.find(itemId);
      if (!item) return reply(404, { error: 'That item is no longer on the board.' });
      if (item.number) return withBoard(409, { error: `This item already has its ticket, #${item.number}.` });
      if (!isTicketNumber(number)) return reply(422, { error: 'Pick one of the tickets the search found.' });
      if (!records || !item.repo) return reply(409, { error: NO_RECORDS });
      const ticket = `${item.repo}#${number}`;
      let read;
      try { read = await items.readTicket(item.repo, number); }
      catch (err) { return withBoard(502, { error: `Could not read ${ticket}. ${(err as Error).message}` }); }
      if (!read) return withBoard(404, { error: `${item.repo} has no open ticket #${number}.` });
      try {
        records.attachTicket(item.id, item.revision, ticket);
        return shown(item.id);
      } catch (err) {
        reread();
        return { ...failed(err), body: { error: (err as Error).message, board: board.snapshot() } };
      }
    },
  };
}
