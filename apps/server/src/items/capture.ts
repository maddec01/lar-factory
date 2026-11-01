// Add item captures local work or creates a tracker ticket, then imports it into List.
import { validateDraft, effectiveIssueSettings, writeAccessProblem, onAzure, type TicketCreationOptions, type ItemDraft, type RepoConfig, type TicketMatch } from '@lar-factory/shared';
import { WorkRecordError, type WorkRecord, type WorkRecords } from '@lar-factory/work-records';
import { structureProvider, structureIssueUrl, type StructureProvider } from '@lar-factory/work-records/tracker-sync';
import { discoverTicketOptions } from '@lar-factory/shared/publication-settings';
import type { BoardState } from '../board/board-state.ts';
import type { Reply } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';
import { importPickedTicket } from './import-ticket.ts';

export interface Capture {
  /** Records the work a submission describes, once per request ID. */
  capture(input: Record<string, unknown>): Promise<Reply>;
  options(repo: unknown): Promise<Reply>;
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

const REQUEST_ID = /^[a-f0-9-]{36}$/;
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
      if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
        return reply(400, { error: 'The submission needs a valid request ID.' });
      }
      let draft: ItemDraft;
      try { draft = validateDraft(input.draft, repos()); }
      catch (err) { return reply(422, { error: (err as Error).message }); }
      if (!records) return reply(409, { error: NO_RECORDS });
      const repo = repoOf(draft.repo)!;
      draft.createIssue ??= repo.setup ? effectiveIssueSettings(repo.setup).createIssuesFromAddItem : false;
      let claim;
      try { claim = records.claimCapture(input.requestId, JSON.stringify(draft)); }
      catch (err) { return reply(409, { error: (err as Error).message }); }
      const { fresh, submission } = claim;
      if (submission.workId) return shown(submission.workId);
      if (submission.failure) return reply(502, { error: submission.failure });
      if (!draft.createIssue) {
        try {
          const { record } = records.completeCapture(input.requestId, { title: draft.title, context: draft.description, repository: draft.repo, kind: draft.kind });
          return shown(record.workId);
        } catch (err) { return failed(err); }
      }
      const uncertain = (extra = '') => reply(409, { uncertain: true, error: `The issue creation outcome is uncertain. This submission cannot create another issue. Check the board and use Find a ticket to recover it.${extra}` });
      let number = submission.ticket ? Number(submission.ticket.slice(submission.ticket.lastIndexOf('#') + 1)) : undefined;
      if (!number && !fresh) {
        try {
          const matches = (await provider.find(draft.repo, input.requestId)).filter(ticket => ticket.body.includes(`<!-- lar-factory:create {"identity":"${input.requestId}"} -->`));
          if (matches.length !== 1) return uncertain(onAzure(draft.repo) ? ' Azure may have stripped its hidden marker.' : '');
          number = matches[0]!.number;
          if (!isTicketNumber(number)) return uncertain();
        } catch { return uncertain(); }
      }
      if (!number) {
        const access = repo.setup?.access ?? {};
        const problem = writeAccessProblem(draft.repo, 'publish-ticket', access, { azureReadOnly: repo.setup?.azureReadOnly });
        if (problem) { records.failCapture(input.requestId, problem); return reply(403, { error: problem }); }
        const mapping = repo.setup?.vocabulary[draft.kind];
        const options = { ...draft.options };
        const safety = { azureReadOnly: repo.setup?.azureReadOnly };
        const labelsAllowed = !writeAccessProblem(draft.repo, 'tag-ticket', access, safety);
        const typesAllowed = !writeAccessProblem(draft.repo, 'type-ticket', access, safety);
        options.labels = labelsAllowed ? options.labels ?? mapping?.labels ?? [] : [];
        options.type = typesAllowed ? options.type ?? mapping?.type ?? undefined : undefined;
        // Recheck capabilities at the server. Hidden or unavailable fields never leak mappings into a write.
        try {
          const available = await discoverOptions(repo);
          options.labels = options.labels.filter(label => available.labels.includes(label));
          if (!available.types.includes(options.type ?? '')) options.type = undefined;
          if (!available.assignees.includes(options.assignee ?? '')) delete options.assignee;
          if (!available.milestones.some(m => m.value === options.milestone)) delete options.milestone;
          if (!available.iterations.includes(options.iteration ?? '')) delete options.iteration;
        } catch {
          options.labels = [];
          options.type = undefined;
          delete options.assignee;
          delete options.milestone;
          delete options.iteration;
        }
        let areaPath: string | undefined;
        let backlogType: string | undefined;
        try {
          if (onAzure(draft.repo)) {
            const team = repo.team ?? (repo.setup?.itemSource?.kind === 'azure-board' ? repo.setup.itemSource.team : undefined);
            if (!team || !provider.creationTarget) throw Error('The Azure team has no readable backlog type or default area. Check its list source.');
            const target = await provider.creationTarget(draft.repo, team);
            backlogType = target.type;
            options.type ||= target.type;
            areaPath = target.areaPath;
          } else if (options.iteration) throw Error('GitHub does not support an iteration option.');
          if (onAzure(draft.repo) && options.milestone) throw Error('Azure does not support a milestone option.');
        } catch (err) {
          records.failCapture(input.requestId, (err as Error).message);
          return failed(err);
        }
        try {
          const latest = repoOf(draft.repo)?.setup;
          const safety = { azureReadOnly: latest?.azureReadOnly };
          const problem = writeAccessProblem(draft.repo, 'publish-ticket', latest?.access ?? {}, safety);
          if (problem) { records.failCapture(input.requestId, problem); return reply(403, { error: problem }); }
          if (writeAccessProblem(draft.repo, 'tag-ticket', latest?.access ?? {}, safety)) options.labels = [];
          if (writeAccessProblem(draft.repo, 'type-ticket', latest?.access ?? {}, safety)) options.type = backlogType;
          const body = `${draft.description}\n\n<!-- lar-factory:create {"identity":"${input.requestId}"} -->`;
          const ticket = await provider.create(draft.repo, draft.title, body, options.type, areaPath, options);
          number = ticket.number;
          if (!Number.isSafeInteger(number) || number <= 0) return uncertain();
        } catch (err) {
          // Only explicit provider refusals prove no ticket was created. Transport and server errors remain uncertain.
          if (/\b(?:400|401|403|404|422)\b/.test((err as Error).message)) {
            records.failCapture(input.requestId, (err as Error).message);
            return failed(err);
          }
          return uncertain();
        }
      }
      try {
        records.saveCaptureTicket(input.requestId, `${draft.repo}#${number}`);
        const { record } = await importPickedTicket(records, draft.repo, { number, title: draft.title,
          text: draft.description, kind: draft.kind, url: structureIssueUrl(draft.repo, number) }, input.requestId);
        return shown(record.workId);
      } catch {
        return reply(502, { uncertain: true, error: `Created ${draft.repo}#${number}, but could not save its record. Use Find a ticket to add it. This submission will not create another issue.` });
      }
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
