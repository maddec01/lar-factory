// Add item captures local work or creates a tracker ticket, then imports it into List.
import type { TicketCreationOptions, RepoConfig, TicketMatch } from '@lar-factory/shared';
import { WorkRecordError, type WorkRecord, type WorkRecords } from '@lar-factory/work-records';
import { structureProvider, type StructureProvider } from '@lar-factory/work-records/tracker-sync';
import { captureWork, createRecordTicket, recordTicketPreview } from '@lar-factory/work-records/create-ticket';
import { discoverTicketOptions } from '@lar-factory/shared/publication-settings';
import type { BoardState } from '../board/board-state.ts';
import type { Reply } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';
import { importPickedTicket } from './import-ticket.ts';

export interface Capture {
  /** Records the work a submission describes, once per request ID. */
  capture(input: Record<string, unknown>): Promise<Reply>;
  options(repo: unknown): Promise<Reply>;
  createTicket(itemId: string, input: Record<string, unknown>): Promise<Reply>;
  ticketPreview(itemId: string): Promise<Reply>;
  /** The repository's open tickets matching the query, each with the work ID of the record holding it, if one does. */
  searchTickets(input: Record<string, unknown>): Promise<Reply>;
  /** Records the picked ticket, or opens the record already holding it, restoring it when set aside. */
  pick(input: Record<string, unknown>): Promise<Reply>;
  /** Gives captured work its ticket; the work ID stays. */
  attachTicket(itemId: string, number: unknown): Promise<Reply>;
}

export interface CaptureDeps {
  provider?: StructureProvider;
  discoverOptions?: (repo: RepoConfig) => Promise<TicketCreationOptions>;
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

const NO_RECORDS = 'The board has no work records to add to.';
const REFUSED = new Set(['ticket-taken', 'stale-revision', 'not-found', 'invalid']);

const reply = (status: number, body: object): Reply => ({ status, body });
const failed = (err: unknown): Reply =>
  reply(err instanceof WorkRecordError && REFUSED.has(err.code) ? 409 : 502, { error: (err as Error).message });
const isTicketNumber = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export function createCapture({ board, items, records, reread, repos, provider = structureProvider(), discoverOptions = discoverTicketOptions }: CaptureDeps): Capture {
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
      if (!records) return reply(409, { error: NO_RECORDS });
      const result = await captureWork(input, { records, repos, provider, discoverOptions });
      return result.body.record ? shown(result.body.record.workId) : result;
    },

    async createTicket(itemId, input) {
      if (!records) return reply(409, { error: NO_RECORDS });
      try {
        const result = await createRecordTicket(itemId, { ...input, retro: false }, { records, repos, provider, discoverOptions });
        return result.body.record ? shown(result.body.record.workId) : result;
      } catch (err) { return failed(err); }
    },

    async ticketPreview(itemId) {
      if (!records) return reply(409, { error: NO_RECORDS });
      try { return reply(200, { preview: recordTicketPreview(records, itemId, repos()), error: null }); }
      catch (err) { return failed(err); }
    },

    async options(value) {
      const repo = repoOf(value);
      if (!repo) return reply(422, { error: 'Choose a configured repository.' });
      try { return reply(200, { options: await discoverOptions(repo), error: null }); }
      catch { return reply(502, { error: 'Could not read issue options. You can still submit the title and description.' }); }
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
        const { record, created } = await importPickedTicket(records, repo.repo, read);
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
