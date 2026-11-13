#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// lar-work: reads and changes work records by opening the work-record database directly, so shaping and build threads
// use it from any folder while the board app is closed. It prints each result as JSON on stdout, a body as its markdown,
// and each error as one line on stderr.

import { sameRepo } from '@lar-factory/shared';
import type { Item, Status, SwapKind } from '@lar-factory/shared';
import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { changeAgentKind, createAgentTicket } from './agent-tracker-writes.ts';
import { agentWrites } from './agent-writes.ts';
import { refreshBoards } from './board-refresh.ts';
import type { OrderingReason } from './brief-review.ts';
import { checkKind } from './change-kind.ts';
import { checkCommand } from './check-runner.ts';
import { exportMarkdown } from './export.ts';
import { gateWorkIds } from './gate-batch.ts';
import { heavyCommand } from './heavy-command.ts';
import { requireHumanAction } from './human-action.ts';
import { releaseCommand } from './release-command.ts';
import { retroCommand } from './retro-command.ts';
import { selectReviewersCommand } from './reviewer-command.ts';
import { roleCommand } from './role-command.ts';
import { runSettingsCommand } from './run-settings-command.ts';
import { scopeCommand } from './scope-command.ts';
import { refreshSpecs, syncSpecs } from './spec-sync.ts';
import { verificationCommand } from './verification-command.ts';
import { workOrder, workOrderReport } from './work-order.ts';
import {
    openWorkRecords,
    readRetention,
    WorkRecordError,
    workRecordsPath,
    writeRetention,
    type Body,
    type BuildPhase,
    type FindingDisposition,
    type DependencyChange,
    type DependencyObservationKind,
    type NewDependency,
    type NewObservation,
    type NewReviewRound,
    type Observed,
    type ReviewAxis,
    type WorkKind,
    type WorkRecords,
} from './work-records.ts';

const HELP = `Usage: lar-work <command> [options]

Reads and changes the factory's work records in the work-record database, which
it opens directly. It works from any folder, with or without the board app.

Confirmed scope, local only
  confirm-scope <work-id> --revision N --file F --identity person --evidence response
                                    Save the scope shown at understanding confirmation:
                                    {repositories:["owner/repo"],openDecisions:[],
                                     files:[],tests:[],behaviour:[],excluded:[],
                                     size:"Small"|"Larger"|null,
                                     verify:{required:boolean,visibleUi:string|null}}.
                                    Verify only for visible UI behaviour a person must check.
                                    Empty lists/null size mean unspecified; never invent scope.
  confirmed-scope <work-id> [--markdown]
                                    Read the confirmation, or render the brief's authoritative
                                    Done when, Scope and Verify sections without re-deriving them.
  choose-structure <work-id>       Read confirmed repositories/openDecisions; return single,
                                    linked or concept with its reason. Missing fields refuse.
  brief-scope-check <work-id>       Compare those sections; report missing/extra claims, exit 1
                                    on mismatch or absent confirmation. Other prose needs Doubt.

Parent release records, local only
  release-plan <work-id>           Read ordered release steps and the Outcome check.
  set-release-plan <work-id> --revision N --file F
                                    Save {steps:[{id,who,what}],outcomeCheck:"observable check"}.
                                    A changed plan needs fresh evidence; old versions remain.
  complete-release-step <work-id> --revision N --step ID --identity person --evidence proof
                                    Record done evidence after preceding steps are done.
  record-outcome-check <work-id> --revision N --result passed|failed --identity person --evidence proof
                                    Record the final observable check after release steps.

Post-merge retro
  retro <work-id>                  Read suggestions, the board choice and capture receipts.
  propose-retro <work-id> --revision N --file F
                                    After confirmed merge/Done, save [{title,description,
                                    repository,kind}] (bug/feature/improvement), or [].
                                    Only board buttons choose and create follow-ups.

Validation records, local only and requiring no revision
  run-check <work-id> --role R [--live] [--reason X] -- <command>
                                    Record a check, wait for a heavy command slot as
                                    heavy does, then run it and exit with its status.
                                    The tree and start time are recorded once the
                                    slot is held.
  reuse-check <work-id> --check ID --role R --reason X
                                    Reuse an eligible non-live pass on the current tree.
  set-check-list <work-id> --file F Save [{"command":["pnpm","test"],"folder":"."}].
                                    Commands and folders match exactly. Slices use their build.
  checks <work-id>                 Print the list, runs, reuses and failure states as JSON.
  describe-failure <check-id> --file F
                                    Save {"tests":["test name"],"diagnosis":"cause"}.
  resolve-failure <check-id> --reason X
                                    Close a failure with its cause or fix. A pass never closes it.

Heavy commands, needing no work ID or board
  heavy [--data-dir D] -- <command>
                                    Wait for a free slot, then run the command and
                                    exit with its status. Slots live in the data
                                    folder and are shared by every build, project
                                    and worktree on this machine. The heavy command
                                    limit, set in the board's Settings, is the
                                    number of slots. The command's words run
                                    without a shell, so use sh -c for a compound
                                    command. It gets no stdin. A heavy command
                                    inside one holding a slot runs at once. If the
                                    slots can't be used, it runs anyway after a
                                    warning. A termination signal reaches only the
                                    command's process group, which is killed if it
                                    is still running a few seconds later. Exits 2
                                    with no command, 127 when the command isn't
                                    found, 126 when it can't start otherwise, and
                                    128 plus N when signal N kills it.
                                    The limit applies only to commands run by heavy
                                    or run-check. It doesn't cap a command's own workers,
                                    control other applications, or guarantee free
                                    CPU or memory.

Identifiers
  A work ID names one work record for its whole life. create and import print it.
  A ticket is a published ticket reference, owner/name#12. A record holds at most
  one, and attaching it keeps the work ID.
  A repository is the repository's name on the board, owner/name.

Run settings, local only
  role-launch <work-id> --run-id ID --role R --capabilities F --task F
                                    Record the attempt and print delegate_task arguments.
                                    F is T3 orchestrator_capabilities JSON (search omitted
                                    models first); task is the role's brief as text.
                                    Uses the supplied LAR_FACTORY_{BIN,SHAPE_SKILL,BUILD_SKILL}
                                    environment. Optional --execution-id reuses an attempt;
                                    --isolation shared|worktree overrides the role default.
  role-finish <work-id> --execution-id ID [--file F]
                                    Read T3's task result JSON (stdin by default), record
                                    and compare it. Failure sets Needs you and exits 1.
  run-settings <work-id> [--run-id ID]
                                    Print immutable snapshots and role execution evidence.
  snapshot-run <work-id> --revision N --file F
                                    Resolve saved Settings once for F's stable runId.
  start-role-run <work-id> --revision N --file F
                                    Record a role attempt and its frozen requested settings.
  finish-role-run <work-id> --revision N --file F
                                    Record actual settings from a T3 report and the result.

Group upkeep, local and deterministic (no tracker reads)
  reconcile <group-id>              List changed sources and mechanical holds as a fingerprinted checklist.
  resolve-reconcile <group-id> --item KEY --digest H --evidence TEXT
                                    Record a source-change review. Mechanical holds require their fix.
  release-steps <group-id>           Read release steps and ships-with pairs.
  set-release-plan <group-id> --revision N --file F
                                    Use canonical {steps:[{id,who,what,shipsWith?:[work IDs]}],outcomeCheck:text}.


Reads
  select-reviewers <work-id> --base SHA --head SHA [--run-id ID]
                   [--escalations F]
                                    Choose reviewers from saved settings and the exact
                                    committed diff in the current build checkout.
                                    Print run/skip reasons, evidence and trigger version.
                                    F is Code's JSON list of {"reviewer":ID,
                                    "requestedBy":"code","reason":text}. Only skipped,
                                    non-never reviewers gain an escalation; run each once.
  concept-build-plan <work-id>      Read all concept start holds and the saved run.
  set-build-run <work-id> --revision N --state running|paused
                                    Start only after every preflight hold clears, or pause.
  work-order <work-id> [--json]     Report group order, briefs, gates, blockers and waits.
  read <work-id>                    Print one record.
  context <work-id>                 Print the markdown the record began with.
  list [--repository R] [--status S] [--kind K]
                                    Print matching records, Queued ones in Queue order.
  kind-disagreement <work-id>       Read the ticket and print {disagreement}, null when
                                    the board would show none: ticketKind (null for none),
                                    changed, kept, the swap change-kind would make, its
                                    note, and accessProblem when this login can't make it.

Changes
  Each change except create and import needs --revision, the revision you last
  read. Unrelated changes are reapplied automatically. Conflicting fields are
  named on stderr; reread the record and decide whether to reapply the write.
  create --title X --repository R --kind K [--status S] [--ticket T] [--file F]
                                    Make a record titled X, a single line, with the
                                    markdown in F as its initial context. Status
                                    defaults to List. create alone stays local.
                                    --request-id ID reuses a capture on reruns.
  create-part --parent ID --revision N --title X --repository R --kind build|decision
              --file F [--blocked-by ID]...
                                    Atomically create a Queued delivery part with its
                                    body, parent and blockers. N is the parent's revision.
                                    R may differ from the parent's repository.
  import --title X --repository R --kind K --ticket T [--status S] [--file F]
                                    Print the record holding T, making it first if
                                    none does. Repeating it never makes a second one
                                    and never changes the title or initial context.
  update <work-id> --revision N [--status S] [--kind K]
                                    [--decision-method grill|prototype|research|task|none]
                                    Changes the record alone. --kind writes nothing to
                                    the ticket; change-kind does.
  change-kind <work-id> --revision N --kind bug|feature|improvement
                                    Give the record this kind and swap it on its ticket,
                                    as item details does: it removes the other kinds'
                                    mapped labels and the kind names, and adds the new
                                    kind's mapped labels and type. Without access for a
                                    write it needs, only the record changes. If a write
                                    fails, the record keeps its kind and the error says
                                    what changed; run it again to finish. Only change a
                                    ticket when the user said yes.
  record-kind-answer <work-id> --revision N --answer keep|update
                     --ticket-kind bug|feature|improvement|none
                                    Record the user's answer about the record's kind
                                    and the ticket's. Changing the record's kind drops it.
  attach-ticket <work-id> --revision N --ticket T
  create-ticket <work-id> --revision N --request-id ID [--retro]
                                    Create and attach an issue, keeping the work ID.
                                    Sends the description, or a current passing Spec
                                    with Original when enabled. Uses kind mappings.
                                    --retro obeys the retro capture setting and sends
                                    the description. Reuse ID to recover a lost result.
                                    A failed create leaves the record local.
  retitle <work ID> --revision N --title X
  title-history <work ID>
  decision-answer <work-id>        Current answer or its replacing reference.
  answer-history <work-id>          Explicit version history.
  supersede-answer <work-id> --revision N --file F
                                    F: {answerRevision,by:{kind,workId,revision,answerRevision?|gateId?},affected:[{workId,revision}]}
  merge-build <work-id> --revision N --file F
                                    F: {into,revisions:{ID:N},dependencyRevisions?:{ID:N}}
                                    Revisions cover survivor, edge endpoints and parent.
  set-aside <work-id> --revision N [--file F]
                                    Resolve every dependent atomically. F is JSON:
                                    [{workId,revision,action,reason,blockerId?,blockerRevision?}]
                                    action: replace, remove or hold.
  set-aside-history <work-id>        Read the retained dependent dispositions.
  restore <work-id> --revision N    Bring a set-aside record back.
  set-needs-you <work-id> --revision N --reason X
                                    Set Status to Needs you and save its reason atomically.
  clear-needs-you <work-id> --revision N --status S
                                    Clear the reason and restore the saved Status atomically.
                                    S cannot be Needs you or Done.
  snapshot-skills <work-id> --revision N [--skill S]...
                                    Record the project skills selected as the build
                                    starts; give none for an empty selection. A
                                    build snapshots once, so later selections
                                    change only future builds.

Structure
  sync-structure <work-id>          Suspended; local legacy content is retained.
                                    No structural tracker writes run. Pending data
                                    and historical recovery material are retained.
                                    Queue order, Status, slices and progress stay local.
                                    Whole gated briefs use the separate Spec path.
  A concept owns decisions and builds. Buildable work owns slices, including
  bugs, features, improvements and issues. A record has at
  most one parent. A blocker is a record the work waits on; a record can't block
  itself or close a cycle. Each change bumps the revision of both records.
  set-parent <work-id> --revision N --parent P
                                    Put the record under P. Clear an old parent first.
  clear-parent <work-id> --revision N
  add-blocker <work-id> --revision N --blocker B
                                    Record that the work waits on B.
  remove-blocker <work-id> --revision N --blocker B
  children <work-id>                Print the records it owns.
  blockers <work-id>                Print the records it waits on, then the unmet
                                    Dependencies holding it.
  dependents <work-id>              Print the records that wait on it.

Completion
  Completion comes from the records alone; a Status, a ticket closing or a
  thread ending never completes work. A build, or any other record that becomes
  a PR, completes once its recorded PR is observed merged. A slice completes once
  it is finished. A decision completes once its answer and domain drafts are
  recorded and its concept's map is written after them. Concept refinement needs
  a nonempty map, Fog gone and every active decision incorporated into that map.
  Proposed builds need not be ready or merged for refinement. Concept delivery
  needs active builds, Fog gone and every active decision and build complete.
  An unfinished concept with no active builds has no delivery planned and stays
  incomplete. Previously finished history is preserved. Refinement alone neither
  starts retention nor releases blockers. An unmet Dependency holds its build.
  Work can start once each of its blockers is complete and no unmet Dependency
  holds it.
  refinement <work-id>              Print concept refinement and incomplete reasons.
  completion <work-id>              Print whether the record is complete and each
                                    reason it isn't.
  waiting-on <work-id>              Print its blockers that aren't complete, then
                                    the unmet Dependencies holding it, with the
                                    reasons. Work can start once this prints [].
  set-fog <work-id> --revision N --fog gone|remaining
                                    Record whether a concept's Fog is gone.
  finish <work-id> --revision N     Record that a slice merged into its build branch.

Content
  A concept holds a map; a decision holds text, a confirmed answer and domain
  drafts; other records hold briefs. Domain docs OFF means no drafts and Domain
  docs says none; legacy private reads as OFF. With it ON, drafts go in the
  whole gated brief and build PR. A --file of - reads standard input.
  Onboarded repositories default issue creation for Add item and retro, and Spec
  writing, to ON. Verified Access and Azure read-only restrictions control writes.
  create-ticket sends a description, or a current passing brief as Spec with
  collapsed Original when enabled. Gating a ticket-backed ordinary brief queues
  the whole Spec automatically, including tickets authored by other people.
  Concepts, decisions, slices and Dependency tickets are excluded.
  Once synced, the ticket is the source of truth; the record keeps a copy for
  gates and builds. Before the first Spec or with the setting OFF, briefs stay
  local. Neither structure sync nor Spec sync writes factory progress.
  set-body <work-id> --revision N --body brief|decision|map|answer|domain-drafts
           --file F
                                    Replace the body with the markdown in F.
  body <work-id> --body B           Print the body as markdown. Brief reads refresh
                                    active Specs; reread the revision after a refresh.
  set-phase <work-id> --revision N --phase P
                                    P is one of plan, implement, domain-docs,
                                    full-checks, review, approve, checks, retro.
  set-pr <work-id> --revision N --pr owner/name#12
                                    Record the PR the build delivers through. A
                                    record holds one current PR; setting another
                                    keeps the earlier one as history.
  pr-history <work-id>              Print the PRs the record held before its current one.
  record-review-round <work-id> --revision N --file F
                                    Record the build's next review round from the
                                    JSON in F: {"base": sha, "reviewers": [{"axis",
                                    "verdict", "notChecked"?, "escalation"?, "findings": [{"severity",
                                    "summary", "disposition", "reason"?}]}]}. Escalation is
                                    {"requestedBy":"code","reason":text}; never wins.
                                    Axes are built-in or saved custom reviewer IDs; verdicts
                                    approve, changes and skipped; severities blocker,
                                    should and nit; dispositions open, fixed and
                                    rejected. A skipped axis or a rejection needs a
                                    reason. A round with any bad part records nothing.
  set-disposition <work-id> --revision N --round R --axis A --finding K
                  --disposition D [--reason X]
                                    Change what became of the axis's Kth finding.
  review-rounds <work-id>           Print the build's review rounds.

Verify evidence, local only
  verification <work-id>            Print the current head, result and fix handoff.
  verification-head <work-id> --pr owner/name#N --head SHA
                                    Record a fresh provider head; a push invalidates a pass.
  record-verification <work-id> --revision N --file F
                                    Refused for agents: Pedro records Verify in the board.
                                    A board failure needs a note and resumes the same build
                                    through the board. Agents never invent Pedro's result.

Brief gate
  gate <work-id>                    Reread the ticket Spec, then print the brief digest,
                                    gate history and specSync warnings or held edits.
                                    Review the refreshed brief and revision before gating.
  doubt-package <work-id>           Print the exact brief and affected-work package for Doubt.
  build-overlap <work-id>           Propose ordering for declared Files/Contracts overlap.
  record-doubt <work-id> --digest H --identity I --evidence E [--file ordering.json]
                                    Bind Doubt to its package; explain unordered overlaps.
  gate-batch --file work-ids.json   Print complete briefs, Doubt results and the batch digest.
  record-gate-batch --file manifest.json --digest H --identity I --evidence E
                                    Refused for agents: ask Pedro to Approve briefs in the board.
  record-gate <work-id> --file display.json --digest H --identity I --evidence E
                                    Refused for agents: ask Pedro to Approve brief in the board.
                                    Set Needs you with the one wait command, then stop.
  Spec writes preserve prior text as Original. A digest on GitHub or revision on
  Azure identifies tracker edits; an unchanged ticket keeps an unsent brief.
  Concurrent tracker text wins, with the unsent text retained in gate history.
  GitHub rereads just before writing but has no conditional body update, leaving
  a small race. Azure tests the revision and uses Repro Steps for Bugs.
  GitHub edits without verified write provenance wait for Accept or Reject in
  details before use. Details saves approve the exact Spec and queue its write.
  Build starts reread the ticket, using the last copy with a warning on failure.
  Edits leave an already running build as it started. Removing Spec markers makes
  the whole description the Spec. Adding a marked ticket on another machine uses
  Original as context and restores no local brief or gate history.

Provider observations
  An observation is the last read of the record's ticket or current PR from its
  provider, kept with the time it was read. A newer read replaces it. A failed
  read keeps it and records when and why the read failed. Spec reads also sync
  trusted tracker title and main-text edits, retaining Status and initial context.
  A merged PR finishes the work; replacing the PR drops its observation.
  observe <work-id> --revision N --of ticket --state open|closed|not-found
          [--assignee A]
  observe <work-id> --revision N --of pr --state open|merged|closed
                                    Record a successful read. A closed PR is
                                    closed unmerged.
  observe-failure <work-id> --revision N --of ticket|pr --failure F
                                    Record that a read failed with reason F.
  observations <work-id>            Print the ticket's observation, then the PR's.

Dependencies
  A Dependency is a change the work needs in a repository you don't work on,
  delivered by the team that owns it. It lives inside one work record, has its
  own ID and revision, and holds only the builds it blocks, each in the same
  work tree as its record. Each block change bumps the build's revision too.
  Only you decide it is met: observations of its ticket and PRs never set or
  clear the mark, and never delete it or its handover. An observation that
  changes after you marked it met flags it for review and leaves it met; marking
  it met again clears the flag. Retention keeps a record while it holds a
  Dependency or one blocks it. Dependency commands take a Dependency ID.
  add-dependency <work-id> --file F Add a Dependency from the JSON in F: {"need",
                                    "owner", "contract"?, "evidence"?, "ticket"?,
                                    "pullRequests"?: [...], "handover"?}. need says
                                    what is needed and why; owner names the owning
                                    repository or team. Prints its Dependency ID.
  dependencies <work-id>            Print the Dependencies the record holds.
  dependency <dependency-id>        Print one Dependency.
  update-dependency <dependency-id> --revision N --file F
                                    Change the fields in the JSON in F; a null
                                    ticket removes it. Observations of a ticket or
                                    PR it no longer names are dropped.
  add-dependency-block <dependency-id> --revision N --build B
                                    Record that the Dependency holds the build B.
  remove-dependency-block <dependency-id> --revision N --build B
  observe-dependency <dependency-id> --revision N --subject S --state K
                     [--detail X]
                                    Record the latest read of S, its ticket or one
                                    of its PRs. K is open, closed, merged, reopened,
                                    deleted, access-lost or read-failed; X is what
                                    the provider said, such as why a read failed.
                                    A failed read or lost access keeps the last
                                    read that answered beside it.
  mark-met <dependency-id> --revision N --identity I
                                    Record that you, I, decided it is met.
  clear-met <dependency-id> --revision N
  replace-dependency <dependency-id> --revision N --build B
                                    Make every build it holds wait on the build B
                                    instead, all in one change. The Dependency and
                                    its met mark stay. Without this, onboarding its
                                    repository later leaves the Dependency as it is.

Threads and launch intents
  A thread ID is T3's. A launch intent is recorded before the board or a factory thread asks T3 to
  start a thread, and resolved once T3 answers, so a restart finds the start
  instead of making a second one. lar-work never starts or checks a thread.
  A purpose is a lowercase word naming what the thread does, such as build.
  add-thread <work-id> --revision N --thread T --purpose P
  confirm-thread-deleted <work-id> --revision N --thread T
  set-build-branch <work-id> --revision N --branch B
  invalidate-gate <work-id> --revision N
                                    Require a new gate, retaining text and history.
  reset-build <work-id> --revision N
                                    Delete owned slices and clear the build phase.
  threads <work-id>                 Print the record's threads.
  record-intent <work-id> --revision N --purpose P
                                    Print the record and the new intent.
  intents [--repository R] [--unresolved]
                                    Print launch intents, oldest first.
  resolve-intent <work-id> --revision N --intent I (--thread T | --failure F)
                                    Resolve the intent to T3's thread T, which joins
                                    the record's threads, or to failure F. An intent
                                    resolves once.

Retention and export
  A record is finished once its delivery PR shows it, and the board finishes a
  decision or concept once it is complete; a Status or a closed ticket never
  finishes it. By default this machine keeps finished and set-aside
  records indefinitely and hides them 7 days after they were finished or set
  aside. Deleting them after a number of days is a separate choice.
  retention [--hide-after N] [--delete-after N|never]
                                    Print this machine's retention setting, after
                                    saving the given changes to it.
  hidden                            Print the records the setting hides now.
  delete-expired                    Delete the records the setting deletes now, with
                                    their bodies, review rounds, threads and intents.
                                    Prints the deleted work IDs, and each due record
                                    kept because a kept record it owns or that waits
                                    on it still needs it, or a Dependency it holds or
                                    that blocks it, with the reason.
  export <work-id> --to D           Write the record's brief, decision or map, its
                                    Dependencies, and a concept's decisions, as
                                    markdown files in the existing folder D, named
                                    from each one's first heading. Prints the paths. The files are a copy
                                    to read; changing them changes no record.

Options
  --data-dir D   Use the work-record database in folder D instead of the
                 factory's data folder (${workRecordsPath()}), and the
                 retention setting there.
  --help         Print this help.

Errors
  A failure prints "lar-work: <reason>" on stderr and exits with 1. The reason
  names the record, ticket or file involved, never a credential. Usage mistakes
  exit with 2. Failed local changes write nothing. A failed ticket create leaves
  its capture local; an uncertain create must reuse its request ID and never
  create another issue. A failed Spec write keeps the local brief pending and
  reports its error without undoing the gate or Ready.
`;

class UsageError extends Error {}

const TAKES_WORK_ID = [
    'kind-disagreement',
    'change-kind',
    'record-kind-answer',
    'create-ticket',
    'sync-structure',
    'read',
    'context',
    'update',
    'attach-ticket',
    'retitle',
    'title-history',
    'decision-answer',
    'answer-history',
    'supersede-answer',
    'merge-build',
    'set-aside',
    'set-aside-history',
    'restore',
    'set-needs-you',
    'clear-needs-you',
    'snapshot-skills',
    'set-parent',
    'clear-parent',
    'add-blocker',
    'remove-blocker',
    'children',
    'blockers',
    'dependents',
    'completion',
    'refinement',
    'waiting-on',
    'work-order',
    'reconcile',
    'resolve-reconcile',
    'release-steps',
    'concept-build-plan',
    'set-build-run',
    'set-fog',
    'finish',
    'set-body',
    'body',
    'set-phase',
    'set-pr',
    'pr-history',
    'record-review-round',
    'set-disposition',
    'set-check-list',
    'checks',
    'describe-failure',
    'resolve-failure',
    'review-rounds',
    'observe',
    'observe-failure',
    'observations',
    'confirm-thread-deleted',
    'set-build-branch',
    'invalidate-gate',
    'reset-build',
    'add-thread',
    'threads',
    'record-intent',
    'resolve-intent',
    'export',
    'gate',
    'record-gate',
    'doubt-package',
    'build-overlap',
    'record-doubt',
    'add-dependency',
    'dependencies',
];
const TAKES_DEPENDENCY_ID = [
    'dependency',
    'update-dependency',
    'add-dependency-block',
    'remove-dependency-block',
    'observe-dependency',
    'mark-met',
    'clear-met',
    'replace-dependency',
];
const COMMANDS = [
    'gate-batch',
    'record-gate-batch',
    'create',
    'create-part',
    'import',
    'list',
    'intents',
    'retention',
    'hidden',
    'delete-expired',
    ...TAKES_WORK_ID,
    ...TAKES_DEPENDENCY_ID,
];

const OPTIONS = {
    item: { type: 'string' },
    json: { type: 'boolean' },
    'confirmed-missing-issue': { type: 'string' },
    plan: { type: 'string' },
    digest: { type: 'string' },
    identity: { type: 'string' },
    evidence: { type: 'string' },
    operation: { type: 'string' },
    claim: { type: 'string' },
    url: { type: 'string' },
    title: { type: 'string' },
    repository: { type: 'string' },
    kind: { type: 'string' },
    'decision-method': { type: 'string' },
    status: { type: 'string' },
    ticket: { type: 'string' },
    revision: { type: 'string' },
    parent: { type: 'string' },
    blocker: { type: 'string' },
    'blocked-by': { type: 'string', multiple: true },
    build: { type: 'string' },
    subject: { type: 'string' },
    detail: { type: 'string' },
    body: { type: 'string' },
    file: { type: 'string' },
    phase: { type: 'string' },
    pr: { type: 'string' },
    round: { type: 'string' },
    axis: { type: 'string' },
    finding: { type: 'string' },
    disposition: { type: 'string' },
    reason: { type: 'string' },
    skill: { type: 'string', multiple: true },
    fog: { type: 'string' },
    of: { type: 'string' },
    state: { type: 'string' },
    assignee: { type: 'string' },
    thread: { type: 'string' },
    branch: { type: 'string' },
    purpose: { type: 'string' },
    intent: { type: 'string' },
    failure: { type: 'string' },
    unresolved: { type: 'boolean' },
    'hide-after': { type: 'string' },
    'delete-after': { type: 'string' },
    to: { type: 'string' },
    'data-dir': { type: 'string' },
    'request-id': { type: 'string' },
    retro: { type: 'boolean' },
    answer: { type: 'string' },
    'ticket-kind': { type: 'string' },
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
        throw new WorkRecordError(
            'invalid',
            `Can't read ${file === '-' ? 'standard input' : file}: ${(error as Error).message}.`,
        );
    }
}

/** A publication request or Dependency in JSON, named as `what`, validated by the database writer. */
function readJson(values: Values, what = 'publication input'): unknown {
    try {
        return JSON.parse(readInput(values)) as unknown;
    } catch (error) {
        if (error instanceof WorkRecordError) throw error;

        throw new WorkRecordError('invalid', `The ${what} in ${values.file} isn't JSON.`);
    }
}

/** The review round in the JSON `--file` holds. */
function readRound(values: Values): NewReviewRound {
    try {
        return JSON.parse(readInput(values)) as NewReviewRound;
    } catch (error) {
        if (error instanceof WorkRecordError) throw error;

        throw new WorkRecordError(
            'invalid',
            `The review round in ${values.file} isn't JSON: ${(error as Error).message}.`,
        );
    }
}

/** Saves the retention options given, then returns this machine's setting. */
function retention(values: Values): unknown {
    const days = (name: 'hide-after' | 'delete-after') => {
        const value = values[name]!;

        if (!/^\d+$/.test(value))
            throw new UsageError(
                `--${name} takes a whole number of days${name === 'delete-after' ? ' or never' : ''}.`,
            );

        return Number(value);
    };
    const current = readRetention(values['data-dir']);

    if (values['hide-after'] === undefined && values['delete-after'] === undefined) return current;

    return writeRetention(
        {
            hideAfterDays: values['hide-after'] === undefined ? current.hideAfterDays : days('hide-after'),
            deleteAfterDays:
                values['delete-after'] === undefined
                    ? current.deleteAfterDays
                    : values['delete-after'] === 'never'
                      ? null
                      : days('delete-after'),
        },
        values['data-dir'],
    );
}

/** Runs `command`; `workId` is the work ID or Dependency ID for the commands that take one. A string result prints as it is, anything else as JSON. */
async function run(
    records: WorkRecords,
    command: string,
    workId: string | undefined,
    values: Values,
): Promise<unknown> {
    const revision = () => Number(need(values, 'revision'));
    const status = values.status as Status | undefined;
    const kind = values.kind as WorkKind | undefined;
    const setupOf = (repository: string) =>
        readRepositorySetups(values['data-dir']).find((setup) => sameRepo(setup.repo, repository));
    const captured = () => ({
        title: need(values, 'title'),
        repository: need(values, 'repository'),
        kind: need(values, 'kind') as WorkKind,
        status,
        context: values.file === undefined ? undefined : readInput(values),
    });

    switch (command) {
        case 'set-check-list':
            return records.setCheckList(
                workId!,
                readJson(values, 'check list') as import('./validation-records.ts').CheckEntry[],
            );
        case 'checks':
            return records.checks(workId!);
        case 'describe-failure':
            return records.describeFailure(
                workId!,
                readJson(values, 'failure') as { tests: string[]; diagnosis: string },
            );
        case 'resolve-failure':
            return records.resolveFailure(workId!, need(values, 'reason'));

        case 'reconcile':
            return records.reconcile(workId!);
        case 'resolve-reconcile':
            return records.resolveReconcile(
                workId!,
                need(values, 'item'),
                need(values, 'digest'),
                need(values, 'evidence'),
            );
        case 'release-steps':
            return records.releaseSteps(workId!);
        case 'sync-structure':
            throw new UsageError('Legacy structural publication is suspended. Local content is retained.');
        case 'gate-batch': {
            const ids = gateWorkIds(readJson(values, 'work IDs'));

            for (const id of ids) {
                await refreshSpecs(records, { workId: id, dir: values['data-dir'], initialize: true });

                if (records.specState(id).held)
                    throw new WorkRecordError(
                        'invalid',
                        `Resolve the held Spec edit for ${id} before displaying the batch.`,
                    );
            }

            return records.gateBatch(ids);
        }
        case 'record-gate-batch':
            return requireHumanAction('Approve briefs');
        case 'doubt-package':
            await refreshSpecs(records, { workId: workId!, dir: values['data-dir'], initialize: true });

            return records.doubtPackage(workId!);
        case 'build-overlap': {
            const input = records.doubtPackage(workId!);

            return { packageDigest: input.packageDigest, overlaps: input.overlaps };
        }
        case 'record-doubt':
            await refreshSpecs(records, { workId: workId!, dir: values['data-dir'], initialize: true });

            return records.recordDoubt(
                workId!,
                need(values, 'digest'),
                need(values, 'identity'),
                need(values, 'evidence'),
                values.file === undefined ? [] : (readJson(values, 'ordering reasons') as OrderingReason[]),
            );
        case 'gate': {
            await refreshSpecs(records, { workId: workId!, dir: values['data-dir'], initialize: true });

            const state = records.specState(workId!);

            return {
                ...records.gate(workId!),
                display: records.displayGate(workId!),
                doubt: records.currentDoubt(workId!),
                specSync: {
                    pending: state.pending !== null,
                    error: state.error,
                    warning: state.warning,
                    awaitingApproval: state.held !== null,
                },
            };
        }
        case 'record-gate':
            return requireHumanAction('Approve brief');
        case 'create-part':
            return records.createPart({
                title: need(values, 'title'),
                repository: need(values, 'repository'),
                parentId: need(values, 'parent'),
                parentRevision: revision(),
                kind: need(values, 'kind') as 'build' | 'decision',
                body: readInput(values),
                blockerIds: values['blocked-by'] ?? [],
            });
        case 'create': {
            const input = { ...captured(), ticket: values.ticket };

            if (!values['request-id']) return records.create(input);

            records.claimCapture(values['request-id'], JSON.stringify(input));

            return records.completeCapture(values['request-id'], input).record;
        }
        case 'create-ticket': {
            const result = await createAgentTicket(
                workId!,
                {
                    revision: revision(),
                    requestId: need(values, 'request-id'),
                    retro: values.retro,
                },
                {
                    records,
                    repos: () =>
                        readRepositorySetups(values['data-dir']).map((setup) => ({
                            repo: setup.repo,
                            setup,
                            labels: [],
                            role: setup.role ?? '',
                            ...(setup.itemSource?.kind === 'azure-board' ? { team: setup.itemSource.team } : {}),
                        })),
                },
            );

            if (result.body.error) throw new WorkRecordError('invalid', result.body.error);

            return result.body.record;
        }
        case 'import':
            return records.importTicket({ ...captured(), ticket: need(values, 'ticket') });
        case 'concept-build-plan':
            return records.conceptBuildPlan(workId!);
        case 'set-build-run':
            return records.setConceptBuildRun(workId!, revision(), need(values, 'state') as 'running' | 'paused');
        case 'work-order': {
            const rows = await records.snapshot(async () => workOrder(records, workId!));

            return values.json ? rows : workOrderReport(rows);
        }
        case 'read':
            return records.read(workId!);
        case 'context':
            return records.initialContext(workId!);
        case 'list':
            return records.list({ repository: values.repository, status, kind });
        case 'update':
            return records.update(workId!, revision(), {
                status,
                kind,
                ...(values['decision-method'] !== undefined
                    ? {
                          decisionMethod:
                              values['decision-method'] === 'none'
                                  ? null
                                  : (values['decision-method'] as Item['decisionMethod']),
                      }
                    : {}),
            });
        case 'kind-disagreement': {
            const record = records.read(workId!);

            return { disagreement: await checkKind(record, { setup: setupOf(record.repository) }) };
        }
        case 'change-kind': {
            const record = records.read(workId!);
            const result = await changeAgentKind(records, workId!, revision(), need(values, 'kind') as SwapKind, {
                setup: setupOf(record.repository),
            });

            if (result.error)
                throw new WorkRecordError(
                    'invalid',
                    result.line ? `${result.error} Changed so far: ${result.line}` : result.error,
                );

            return { record: result.record, line: result.line };
        }
        case 'record-kind-answer': {
            const ticketKind = need(values, 'ticket-kind');

            return records.recordKindAnswer(workId!, revision(), {
                answer: need(values, 'answer') as 'keep' | 'update',
                ticketKind: ticketKind === 'none' ? null : (ticketKind as WorkKind),
            });
        }
        case 'attach-ticket':
            return records.attachTicket(workId!, revision(), need(values, 'ticket'));
        case 'retitle':
            return records.retitle(workId!, revision(), need(values, 'title'));
        case 'title-history':
            return records.titleHistory(workId!);
        case 'decision-answer':
            return records.decisionAnswer(workId!);
        case 'answer-history':
            return records.answerHistory(workId!);
        case 'supersede-answer':
            return records.supersedeAnswer(
                workId!,
                revision(),
                readJson(values, 'answer supersession') as Parameters<WorkRecords['supersedeAnswer']>[2],
            );
        case 'merge-build':
            return records.mergeBuild(
                workId!,
                revision(),
                readJson(values, 'proposed build merge') as Parameters<WorkRecords['mergeBuild']>[2],
            );
        case 'set-aside':
            return records.setAside(
                workId!,
                revision(),
                values.file === undefined
                    ? []
                    : (readJson(values, 'dependent resolutions') as import('./set-aside.ts').DependentResolution[]),
            );
        case 'set-aside-history':
            return records.setAsideHistory(workId!);
        case 'restore':
            return records.restore(workId!, revision());
        case 'set-needs-you':
            return records.waitForUser(workId!, revision(), need(values, 'reason'));
        case 'clear-needs-you':
            return records.resumeFromUser(workId!, revision(), need(values, 'status') as Status);
        case 'snapshot-skills':
            return records.snapshotSkills(workId!, revision(), values.skill ?? []);
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
            return [...records.blockers(workId!), ...records.unmetDependencies(workId!)];
        case 'dependents':
            return records.dependents(workId!);
        case 'refinement':
            return records.refinement(workId!);
        case 'completion':
            return records.completion(workId!);
        case 'waiting-on':
            return records.waitingOn(workId!);
        case 'set-fog': {
            const fog = need(values, 'fog');

            if (fog !== 'gone' && fog !== 'remaining') throw new UsageError('--fog takes gone or remaining.');

            return records.setFogGone(workId!, revision(), fog === 'gone');
        }
        case 'finish':
            if (records.read(workId!).kind !== 'slice')
                throw new WorkRecordError(
                    'invalid',
                    'Only a slice is finished by hand; a build finishes when its PR is observed merged.',
                );

            return records.recordFinished(workId!, revision());
        case 'set-body':
            return records.setBody(workId!, revision(), need(values, 'body') as Body, readInput(values));
        case 'body': {
            if (values.body === 'brief') await refreshSpecs(records, { workId: workId!, dir: values['data-dir'] });

            const body = need(values, 'body') as Body;
            const markdown = records.body(workId!, body);

            if (markdown === null) {
                const replacement = body === 'answer' ? records.decisionAnswer(workId!).supersededBy : null;

                throw new WorkRecordError(
                    'not-found',
                    replacement
                        ? `The answer was superseded by ${JSON.stringify(replacement)}; use decision-answer or answer-history.`
                        : `The work record ${workId} has no ${body}.`,
                );
            }

            return markdown;
        }
        case 'set-phase':
            return records.setBuildPhase(workId!, revision(), need(values, 'phase') as BuildPhase);
        case 'set-pr':
            return records.setPullRequest(workId!, revision(), need(values, 'pr'));
        case 'pr-history':
            return records.replacedPullRequests(workId!);
        case 'record-review-round':
            return records.recordReviewRound(workId!, revision(), readRound(values));
        case 'set-disposition':
            return records.setFindingDisposition(
                workId!,
                revision(),
                {
                    round: Number(need(values, 'round')),
                    axis: need(values, 'axis') as ReviewAxis,
                    finding: Number(need(values, 'finding')),
                },
                need(values, 'disposition') as FindingDisposition,
                values.reason,
            );
        case 'review-rounds':
            return records.reviewRounds(workId!);
        case 'observe':
            return records.observe(workId!, revision(), {
                of: need(values, 'of'),
                state: need(values, 'state'),
                assignee: values.assignee,
            } as NewObservation);
        case 'observe-failure':
            return records.recordReadFailure(
                workId!,
                revision(),
                need(values, 'of') as Observed,
                need(values, 'failure'),
            );
        case 'observations':
            return records.observations(workId!);
        case 'confirm-thread-deleted':
            return records.confirmThreadDeleted(workId!, revision(), need(values, 'thread'));
        case 'set-build-branch':
            return records.setBuildBranch(workId!, revision(), need(values, 'branch'));
        case 'invalidate-gate':
            return records.invalidateGate(workId!, revision());
        case 'reset-build':
            return records.resetBuild(workId!, revision());
        case 'add-thread':
            return records.addThread(workId!, revision(), need(values, 'thread'), need(values, 'purpose'));
        case 'threads':
            return records.threads(workId!);
        case 'record-intent':
            return records.recordLaunchIntent(workId!, revision(), need(values, 'purpose'));
        case 'intents':
            return records.launchIntents({ repository: values.repository, unresolved: values.unresolved });
        case 'resolve-intent': {
            if ((values.thread === undefined) === (values.failure === undefined))
                throw new UsageError('resolve-intent needs --thread or --failure, not both.');

            const outcome = values.thread !== undefined ? { threadId: values.thread } : { failure: values.failure! };

            return records.resolveLaunchIntent(workId!, revision(), need(values, 'intent'), outcome);
        }
        case 'add-dependency':
            return records.addDependency(workId!, readJson(values, 'Dependency') as NewDependency);
        case 'dependencies':
            return records.dependencies(workId!);
        case 'dependency':
            return records.dependency(workId!);
        case 'update-dependency':
            return records.updateDependency(
                workId!,
                revision(),
                readJson(values, 'Dependency change') as DependencyChange,
            );
        case 'add-dependency-block':
            return records.addDependencyBlock(workId!, revision(), need(values, 'build'));
        case 'remove-dependency-block':
            return records.removeDependencyBlock(workId!, revision(), need(values, 'build'));
        case 'observe-dependency':
            return records.observeDependency(workId!, revision(), {
                subject: need(values, 'subject'),
                kind: need(values, 'state') as DependencyObservationKind,
                detail: values.detail,
            });
        case 'mark-met':
            return records.markDependencyMet(workId!, revision(), need(values, 'identity'));
        case 'clear-met':
            return records.clearDependencyMet(workId!, revision());
        case 'replace-dependency':
            return records.replaceDependencyWithBuild(workId!, revision(), need(values, 'build'));
        case 'hidden':
            return records.hidden(readRetention(values['data-dir']));
        case 'delete-expired':
            return records.deleteExpired(readRetention(values['data-dir']));
        case 'export':
            return exportMarkdown(records, workId!, resolve(need(values, 'to')));
        default:
            throw new UsageError(`Unknown command "${command}".`);
    }
}

async function main(args: string[]): Promise<number> {
    if (args[0] === 'role-launch' || args[0] === 'role-finish') return roleCommand(args[0], args.slice(1));

    if (args[0] === 'run-check' || args[0] === 'reuse-check') return checkCommand(args);

    if (args[0] === 'select-reviewers') return selectReviewersCommand(args.slice(1));

    if (['run-settings', 'snapshot-run', 'start-role-run', 'finish-role-run'].includes(args[0]!))
        return runSettingsCommand(args[0]!, args.slice(1));

    if (['retro', 'propose-retro'].includes(args[0]!)) return retroCommand(args[0]!, args.slice(1));

    if (['verification', 'verification-head', 'record-verification'].includes(args[0]!))
        return verificationCommand(args[0]!, args.slice(1));

    if (['release-plan', 'set-release-plan', 'complete-release-step', 'record-outcome-check'].includes(args[0]!))
        return releaseCommand(args[0]!, args.slice(1));

    if (['confirm-scope', 'confirmed-scope', 'brief-scope-check', 'choose-structure'].includes(args[0]!))
        return scopeCommand(args[0]!, args.slice(1));

    if (args[0] === 'heavy') return heavyCommand(args);

    let parsed;

    try {
        parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true });
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\nRun lar-work --help for usage.\n`);

        return 2;
    }

    const {
        values,
        positionals: [command, workId, ...extra],
    } = parsed;

    if (values.help || !command) {
        process.stdout.write(HELP);

        return values.help ? 0 : 2;
    }

    let records: WorkRecords | undefined;

    try {
        if (extra.length) throw new UsageError(`Unexpected arguments: ${extra.join(' ')}.`);

        if (!COMMANDS.includes(command)) throw new UsageError(`Unknown command "${command}".`);

        const takesId = TAKES_WORK_ID.includes(command) || TAKES_DEPENDENCY_ID.includes(command);

        if (takesId !== (workId !== undefined)) {
            const id = TAKES_DEPENDENCY_ID.includes(command) ? 'a Dependency ID' : 'a work ID';

            throw new UsageError(workId === undefined ? `${command} needs ${id}.` : `${command} takes no work ID.`);
        }

        if (command === 'retention') {
            process.stdout.write(`${JSON.stringify(retention(values), null, 2)}\n`);

            return 0;
        }

        records = agentWrites(await openWorkRecords(workRecordsPath(values['data-dir'])));

        const result = await run(records, command, workId, values);

        if (['set-phase', 'set-build-run', 'reconcile', 'resolve-reconcile'].includes(command))
            await refreshBoards(workId!, values['data-dir']);

        const validationCommand = [
            'reconcile',
            'resolve-reconcile',
            'release-steps',
            'set-check-list',
            'checks',
            'describe-failure',
            'resolve-failure',
            'work-order',
            'concept-build-plan',
        ].includes(command);

        if (!validationCommand) await syncSpecs(records, { dir: values['data-dir'] });

        if (!validationCommand && workId && !TAKES_DEPENDENCY_ID.includes(command)) {
            const sync = records.specState(workId);

            if (sync.error || sync.warning) process.stderr.write(`lar-work: ${sync.warning ?? sync.error}\n`);
        }

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
