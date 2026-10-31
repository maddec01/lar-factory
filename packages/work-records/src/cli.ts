#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// lar-work: reads and changes work records by opening the work-record database directly, so shaping and build threads
// use it from any folder while the board app is closed. It prints each result as JSON on stdout, a body as its markdown,
// and each error as one line on stderr.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Status } from '@lar-factory/shared';
import {
  openWorkRecords, WorkRecordError, workRecordsPath, type Body, type BuildPhase, type FindingDisposition, type NewReviewRound, type ReviewAxis,
  type WorkKind, type WorkRecords,
} from './work-records.ts';

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

Structure
  A concept owns decisions and builds, and a build owns slices. A record has at
  most one parent. A blocker is a record the work waits on; a record can't block
  itself or close a cycle. Each change bumps the revision of both records.
  set-parent <work-id> --revision N --parent P
                                    Put the record under P. Clear an old parent first.
  clear-parent <work-id> --revision N
  add-blocker <work-id> --revision N --blocker B
                                    Record that the work waits on B.
  remove-blocker <work-id> --revision N --blocker B
  children <work-id>                Print the records it owns.
  blockers <work-id>                Print the records it waits on.
  dependents <work-id>              Print the records that wait on it.

Content
  A record keeps its markdown here only; nothing is written to a ticket. A
  concept holds a map, a decision its text, and any other record a brief. A
  --file of - reads standard input.
  set-body <work-id> --revision N --body brief|decision|map --file F
                                    Replace the body with the markdown in F.
  body <work-id> --body B           Print the body as markdown.
  set-phase <work-id> --revision N --phase P
                                    P is one of plan, implement, domain-docs,
                                    full-checks, review, approve, checks, retro.
  set-pr <work-id> --revision N --pr owner/name#12
                                    Record the PR the build delivers through.
  record-review-round <work-id> --revision N --file F
                                    Record the build's next review round from the
                                    JSON in F: {"base": sha, "reviewers": [{"axis",
                                    "verdict", "notChecked"?, "findings": [{"severity",
                                    "summary", "disposition", "reason"?}]}]}. Axes are
                                    code, security, ui and performance; verdicts
                                    approve, changes and skipped; severities blocker,
                                    should and nit; dispositions open, fixed and
                                    rejected. A skipped axis or a rejection needs a
                                    reason. A round with any bad part records nothing.
  set-disposition <work-id> --revision N --round R --axis A --finding K
                  --disposition D [--reason X]
                                    Change what became of the axis's Kth finding.
  review-rounds <work-id>           Print the build's review rounds.

Threads and launch intents
  A thread ID is T3's. A launch intent is recorded before the board asks T3 to
  start a thread, and resolved once T3 answers, so a restart finds the start
  instead of making a second one. lar-work never starts or checks a thread.
  A purpose is a lowercase word naming what the thread does, such as build.
  add-thread <work-id> --revision N --thread T --purpose P
  threads <work-id>                 Print the record's threads.
  record-intent <work-id> --revision N --purpose P
                                    Print the record and the new intent.
  intents [--repository R] [--unresolved]
                                    Print launch intents, oldest first.
  resolve-intent <work-id> --revision N --intent I (--thread T | --failure F)
                                    Resolve the intent to T3's thread T, which joins
                                    the record's threads, or to failure F. An intent
                                    resolves once.

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

const TAKES_WORK_ID = ['read', 'update', 'attach-ticket', 'set-aside', 'restore', 'set-parent', 'clear-parent', 'add-blocker', 'remove-blocker',
  'children', 'blockers', 'dependents', 'set-body', 'body', 'set-phase', 'set-pr', 'record-review-round', 'set-disposition', 'review-rounds',
  'add-thread', 'threads', 'record-intent', 'resolve-intent'];
const COMMANDS = ['create', 'import', 'list', 'intents', ...TAKES_WORK_ID];

const OPTIONS = {
  repository: { type: 'string' },
  kind: { type: 'string' },
  status: { type: 'string' },
  ticket: { type: 'string' },
  revision: { type: 'string' },
  parent: { type: 'string' },
  blocker: { type: 'string' },
  body: { type: 'string' },
  file: { type: 'string' },
  phase: { type: 'string' },
  pr: { type: 'string' },
  round: { type: 'string' },
  axis: { type: 'string' },
  finding: { type: 'string' },
  disposition: { type: 'string' },
  reason: { type: 'string' },
  thread: { type: 'string' },
  purpose: { type: 'string' },
  intent: { type: 'string' },
  failure: { type: 'string' },
  unresolved: { type: 'boolean' },
  'data-dir': { type: 'string' },
  help: { type: 'boolean' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

type StringOption = { [K in keyof Values]-?: Values[K] extends string | undefined ? K : never }[keyof Values];

function need(values: Values, name: StringOption): string {
  const value = values[name];
  if (value === undefined) throw new UsageError(`--${name} is required.`);
  return value;
}

/** The text in the file `--file` names, or standard input for `-`. */
function readInput(values: Values): string {
  const file = need(values, 'file');
  try {
    return readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (error) {
    throw new WorkRecordError('invalid', `Can't read ${file === '-' ? 'standard input' : file}: ${(error as Error).message}.`);
  }
}

/** The review round in the JSON `--file` holds. */
function readRound(values: Values): NewReviewRound {
  try {
    return JSON.parse(readInput(values)) as NewReviewRound;
  } catch (error) {
    if (error instanceof WorkRecordError) throw error;
    throw new WorkRecordError('invalid', `The review round in ${values.file} isn't JSON: ${(error as Error).message}.`);
  }
}

/** Runs `command`; `workId` is set for the commands that take one. A string result prints as it is, anything else as JSON. */
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
    case 'set-parent':
      return records.setParent(workId!, revision(), need(values, 'parent'));
    case 'clear-parent':
      return records.clearParent(workId!, revision());
    case 'add-blocker':
      return records.addBlocker(workId!, revision(), need(values, 'blocker'));
    case 'remove-blocker':
      return records.removeBlocker(workId!, revision(), need(values, 'blocker'));
    case 'children':
      return records.children(workId!);
    case 'blockers':
      return records.blockers(workId!);
    case 'dependents':
      return records.dependents(workId!);
    case 'set-body':
      return records.setBody(workId!, revision(), need(values, 'body') as Body, readInput(values));
    case 'body': {
      const body = need(values, 'body') as Body;
      const markdown = records.body(workId!, body);
      if (markdown === null) throw new WorkRecordError('not-found', `The work record ${workId} has no ${body}.`);
      return markdown;
    }
    case 'set-phase':
      return records.setBuildPhase(workId!, revision(), need(values, 'phase') as BuildPhase);
    case 'set-pr':
      return records.setPullRequest(workId!, revision(), need(values, 'pr'));
    case 'record-review-round':
      return records.recordReviewRound(workId!, revision(), readRound(values));
    case 'set-disposition':
      return records.setFindingDisposition(workId!, revision(),
        { round: Number(need(values, 'round')), axis: need(values, 'axis') as ReviewAxis, finding: Number(need(values, 'finding')) },
        need(values, 'disposition') as FindingDisposition, values.reason);
    case 'review-rounds':
      return records.reviewRounds(workId!);
    case 'add-thread':
      return records.addThread(workId!, revision(), need(values, 'thread'), need(values, 'purpose'));
    case 'threads':
      return records.threads(workId!);
    case 'record-intent':
      return records.recordLaunchIntent(workId!, revision(), need(values, 'purpose'));
    case 'intents':
      return records.launchIntents({ repository: values.repository, unresolved: values.unresolved });
    case 'resolve-intent': {
      if ((values.thread === undefined) === (values.failure === undefined)) throw new UsageError('resolve-intent needs --thread or --failure, not both.');
      const outcome = values.thread !== undefined ? { threadId: values.thread } : { failure: values.failure! };
      return records.resolveLaunchIntent(workId!, revision(), need(values, 'intent'), outcome);
    }
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
    const result = run(records, command, workId, values);
    process.stdout.write(typeof result === 'string' ? result : `${JSON.stringify(result, null, 2)}\n`);
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
