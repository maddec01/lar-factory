#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// lar-work: reads and changes work records by opening the work-record database directly, so shaping and build threads
// use it from any folder while the board app is closed. It prints each record as JSON on stdout and each error as one
// line on stderr.

import { parseArgs } from 'node:util';
import type { Status } from '@lar-factory/shared';
import { openWorkRecords, WorkRecordError, workRecordsPath, type WorkKind, type WorkRecords } from './work-records.ts';

const HELP = `Usage: lar-work <command> [options]

Reads and changes the factory's work records in the work-record database, which
it opens directly. It works from any folder, with or without the board app.

Identifiers
  A work ID names one work record for its whole life. create and import print it.
  A ticket is a published ticket reference, owner/name#12. A record holds at most
  one, and attaching it keeps the work ID.
  A repository is the repository's name on the board, owner/name.

Reads
  read <work-id>                    Print one record.
  list [--repository R] [--status S] [--kind K]
                                    Print matching records, Queued ones in Queue order.

Changes
  Each change except create and import needs --revision, the revision you last
  read. When the record has moved on, the change fails and nothing is written.
  create --repository R --kind K [--status S] [--ticket T]
                                    Make a record. Status defaults to List.
  import --repository R --kind K --ticket T [--status S]
                                    Print the record holding T, making it first if
                                    none does. Repeating it never makes a second one.
  update <work-id> --revision N [--status S] [--kind K]
  attach-ticket <work-id> --revision N --ticket T
  set-aside <work-id> --revision N  Set the record aside. Its Status stays.
  restore <work-id> --revision N    Bring a set-aside record back.

Options
  --data-dir D   Use the work-record database in folder D instead of the
                 factory's data folder (${workRecordsPath()}).
  --help         Print this help.

Errors
  A failure prints "lar-work: <reason>" on stderr and exits with 1. The reason
  names the record, ticket or file involved, never a credential. Usage mistakes
  exit with 2. Records stay as they were after any failure.
`;

class UsageError extends Error {}

const COMMANDS = ['create', 'import', 'read', 'list', 'update', 'attach-ticket', 'set-aside', 'restore'];
const TAKES_WORK_ID = ['read', 'update', 'attach-ticket', 'set-aside', 'restore'];

const OPTIONS = {
  repository: { type: 'string' },
  kind: { type: 'string' },
  status: { type: 'string' },
  ticket: { type: 'string' },
  revision: { type: 'string' },
  'data-dir': { type: 'string' },
  help: { type: 'boolean' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

function need(values: Values, name: 'repository' | 'kind' | 'ticket' | 'revision'): string {
  const value = values[name];
  if (value === undefined) throw new UsageError(`--${name} is required.`);
  return value;
}

/** Runs `command`; `workId` is set for the commands that take one. */
function run(records: WorkRecords, command: string, workId: string | undefined, values: Values): unknown {
  const revision = () => Number(need(values, 'revision'));
  const status = values.status as Status | undefined;
  const kind = values.kind as WorkKind | undefined;
  switch (command) {
    case 'create':
      return records.create({ repository: need(values, 'repository'), kind: need(values, 'kind') as WorkKind, status, ticket: values.ticket });
    case 'import':
      return records.importTicket({ repository: need(values, 'repository'), kind: need(values, 'kind') as WorkKind, ticket: need(values, 'ticket'), status });
    case 'read':
      return records.read(workId!);
    case 'list':
      return records.list({ repository: values.repository, status, kind });
    case 'update':
      return records.update(workId!, revision(), { status, kind });
    case 'attach-ticket':
      return records.attachTicket(workId!, revision(), need(values, 'ticket'));
    case 'set-aside':
      return records.setAside(workId!, revision());
    case 'restore':
      return records.restore(workId!, revision());
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

async function main(args: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    process.stderr.write(`lar-work: ${(error as Error).message}\nRun lar-work --help for usage.\n`);
    return 2;
  }
  const { values, positionals: [command, workId, ...extra] } = parsed;
  if (values.help || !command) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }
  let records: WorkRecords | undefined;
  try {
    if (extra.length) throw new UsageError(`Unexpected arguments: ${extra.join(' ')}.`);
    if (!COMMANDS.includes(command)) throw new UsageError(`Unknown command "${command}".`);
    if (TAKES_WORK_ID.includes(command) !== (workId !== undefined)) {
      throw new UsageError(workId === undefined ? `${command} needs a work ID.` : `${command} takes no work ID.`);
    }
    records = await openWorkRecords(workRecordsPath(values['data-dir']));
    process.stdout.write(`${JSON.stringify(run(records, command, workId, values), null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`lar-work: ${error.message}\nRun lar-work --help for usage.\n`);
      return 2;
    }
    if (error instanceof WorkRecordError) {
      process.stderr.write(`lar-work: ${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    records?.close();
  }
}

process.exitCode = await main(process.argv.slice(2));
