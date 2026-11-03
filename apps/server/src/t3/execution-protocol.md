# Execution protocol

Server callers use `readExecution` for bounded thread-ID lookup and
`subscribeExecution` for retained timestamped thread projections. Both reuse
`ProjectProtocol.subscriptionSession` and the project Effect RPC ticket transport.
`readThreadFamily` reads active family shells. `subscribeExecutionShell` reads
projects and active threads, and `readArchivedShells` reads archived threads.
Consumers must check availability
before treating a retained observation as current. Neither failure nor an empty
family establishes deletion. Only `t3 thread show` confirms a deletion.

The reference contract is pingdotgg/t3code 97e35bcf23e4dcf34c2dcffadd37c08db0e01e52,
nightly 0.1.6-nightly.20261030.3917. This identifies the source used to implement
the adapter, not a required installed release. Reads authenticate and validate
response envelopes and consumed fields on any T3 release. Malformed responses
and unavailable endpoints retain the last observation and report failure.
Source pointers are
packages/contracts/src/orchestrationV2.ts:1974, 2176, 3617, 3650 and 3832, and
packages/contracts/src/rpc.ts:1810. Projection entity records remain opaque after
array and envelope validation. Following consumers must validate the fields they
consume. Runs, attempts, subagents, provider turns, runtime requests and messages
are included. Shell records carry worktree and PR context where populated.
Azure policy evaluations and reviewer votes are unsupported. The adapter does
not count tokens. Association, transcript mapping and timing use protocol observations. Launch behavior remains #710.

Reconnect obtains a fresh ticket and snapshot. Unknown or incremental execution
events request a fresh snapshot by reconnecting rather than guessing reducers.
Failures retain the observation and its time. Stale snapshots are ignored;
marked `resolvedRepositoryIdentityRoots` snapshots update metadata for existing
projects only, at the same or a later sequence. They preserve other projects,
active threads and archived threads and do not advance the membership event
cursor. Unmarked snapshots replace membership, so deletions remain effective.

Runtime evidence on 2026-10-31, local server port 3773: the board's separate
Keychain session authenticated two thread subscriptions with a forced disconnect
between them. Both returned thread 7890e962-9472-4a5d-bd99-91a9bc0aeeb9 at
sequence 219530. Two calls through `readExecution` returned available and matched
that ID; `readThreadFamily` returned available with one member. A separate shell
probe reconnected successfully. Real credential rejection, renewal failure and
server restart were not exercised. Probe scripts live in /tmp and contain no
credentials; credentials were read directly from Keychain into process memory.

Item-thread refresh uses `item-execution.ts`: active and archived shell arrays,
with both omission flags disabled, followed by bounded thread-ID projection
reads. An item's threads are the thread IDs its work record holds; a thread's
first user message no longer associates it. Onboarding title lookup uses the
same completed observation. While T3 can't be read, each recorded thread shows
its last observation with that observation's time, or unavailable once one was
never seen. A recorded thread missing from a completed snapshot is left out
until the T3 CLI confirms it deleted.

Stats use the same protocol observations and answer per item. An item's family is
its recorded threads and their lineage descendants. `protocolStatsInputs` reports
each thread as current, pending (its shell changed after an earlier success, so it
counts from that read), never read, failed (until a read succeeds, counting from any
retained observation only for deduplication) or gone (deleted, or on neither thread
list once both were read). A failed thread fails its family, and a thread never read
makes its family load. T3 stopped or an unreadable thread list still fails every
item, and T3 running with its list not yet read loads every item. Figures stay
provisional until the first read settles and every needed thread was observed once:
they show, but aren't retained, frozen or written to a PR. There is still no
transcript-session SQL fallback for an unread thread.

T3's `orchestration.subscribeShell` always sends `archivedThreads: []`
(`buildActiveShellSnapshot` in apps/server/src/orchestration-v2/ShellStream.ts), and
archiving a thread sends `thread.removed` for the active list. `readArchivedShells`
calls `orchestration.getArchivedShellSnapshot` (packages/contracts/src/orchestrationV2.ts:3572
and 4122). `item-execution.ts` issues that read only when a caller asks about a thread
the active shells lack, and at most once in 30 seconds unless a thread leaves the
active shells. A failed read keeps the last list for display. Thread start recovery and
live worktree paths keep reading the subscribed shells alone. An item's archived
threads sort after its other threads because archiving updates `updatedAt`. Settling
updates it too, so a settled thread sorts by its latest run's time instead, which keeps
Open thread on the build after the board settles a shaping thread. T3 opens
New thread for an archived thread's `t3code://threads/...` link, so the board shows
such a thread as archived and never links it.

Archived read proof, 2026-11-02, T3 0.1.7-nightly.20261102.4066, port 3773: three calls
on one connection returned 51 threads, 8 projects and about 120 KB in 54, 14 and 14 ms,
with `archivedAt` set on the archived test thread. The list here is small beside the
3,000 or more active threads, but a read opens a connection and parses the whole list.
The board skips it only while every recorded thread is in the active shells. Any
recorded thread missing from them, such as an archived thread, starts a read every 30
seconds for the server's life.


Stats coverage (#709): `execution-stats.ts` maps providerTurns to turn intervals,
runtimeRequests to user waits, subagents to child intervals, messages to first-user
association and last-message bounds, and providerThreads to active IDs and native
transcript references. providerSessions are runtime attachments, not transcript
identities. Source: pinned contracts `orchestrationV2.ts` provider-thread,
provider-turn, runtime-request and thread-projection schemas in /tmp/t3src.

The production stats path retains exactly `CODEX_TURN_SELECTIONS` in `t3-db.ts`:
provider turns' nativeTurnRef and run_attempt_id join run attempts by attempt,
thread and provider-thread IDs; attempt payload supplies nativeThreadId. For each
attempt, the earliest version-2 thread `run.updated` event matching run ID,
activeAttemptId and running status supplies modelSelection. Native turn IDs are
bound through json_each(?). This is needed only for unresolved Codex service-tier
pricing: the current projection's modelSelection cannot recover the selection
before later steering. No timing or transcript-session SQL fallback runs here.
Legacy threadRows/threadSessions helpers remain for other callers and parity
fixtures; they are not the production stats input path.

The item-stats fixture suite compares every returned protocol result against its
SQL predecessor, including parent overlap, waits, open/abandoned turns, native
sessions, cross-thread transcript deduplication and pricing. t3-reads fixtures
exercise unavailable observations and cold/warm transcript caching separately.

Real stats mapping proof, 2026-10-31, supported local server on port 3773:
two authenticated subscriptions separated by disconnect returned thread
f25dc5eb-a8fc-4424-ac05-3cfa51551808, sequence 498838. `executionStats`
accepted both snapshots: 159 provider turns, 2 waits, 58 subagent runs and
14 transcript sessions. The unchanged agentTime calculator returned agent and
wall time 8,977,753 ms for this single-thread projection (a synthetic issue
association was supplied only to address the lookup). This is projection/timing
proof, not full-family or real transcript pricing parity. Descendant projections,
real token totals, renewal rejection and restart remain runtime limits; controlled
fixtures cover calculation parity and unavailable observations. The probe used the
board's existing Keychain credential in memory and printed only counts/timing.

CLI recovery proof, 2026-10-31: repositoryProjects returned the registered
lar-factory main-checkout project, mcp:0ee5d266-467e-4bda-a7e9-7690c8ebb34f.
`thread list --project <id> --json` returned 127 threads with exit 0;
`thread show <listed-id> --json --messages 0` returned the matching thread
with exit 0. The installed CLI has no project-list subcommand. Discovery used
the authenticated adapter, not the worktree folder as a project ID.
Recovery reads complete CLI messages and requires a unique exact first-user
message match. Empty, ambiguous and failed reads retain duplicate protection.
Real timeout followed by a late launch, deletion and provider mutations were
not induced by this probe.

Association no longer opens SQLite or requires a usage database. The board
reads threads through `protocolItemThreads` apart from `loadT3Reads`, so threads
read when stats are disabled or their residual pricing read fails. A missing usage database reports unavailable stats.
The source audit finds no production project, title, association or timing SQL
consumer outside the adapter. Legacy SQL helpers remain for parity fixtures;
`item-stats.ts` retains its optional `threadSessions` default for those fixtures.
Production supplies protocol sessions explicitly. The residual production query
is `CODEX_TURN_SELECTIONS` described above, not project or thread discovery.

## Thread commands

`sendThreadCommand` in `thread-commands.ts` sends `thread.settle`, `thread.archive`
or `thread.delete` through the `orchestration.dispatchCommand` RPC, which answers
`{ sequence }`. Source pointers at the reference commit are
packages/contracts/src/orchestrationV2.ts:2894, 2915, 2920 and 3612. The `t3` CLI
has no command for these. Each call issues one operate-scope session and revokes
it afterwards. The call opens one connection and never reconnects. A failed `Exit`
frame reports `rejected`. A timeout, a dropped connection, a malformed answer or a
failed session issue reports `unconfirmed`. A retry after `unconfirmed` keeps the same
`commandId`. T3 stores a receipt for a rejection and answers that ID with the same
rejection (`Orchestrator.ts`, `OrchestratorCommandPreviouslyRejectedError`), so a retry
after `rejected` uses a new one.

`threadCleanupState` in `item-execution.ts` answers from the current shell snapshot
and, for a thread that snapshot lacks, from an archived read still within its 30
seconds. It never answers from a retained observation, so the shaping thread sweep
reads a thread just before it sends a command. Without a current archived read it
answers unavailable, never absent. Spawned test boards replace `item-execution.ts`
with `test/execution-observations.ts`, whose answer is always unavailable, so no
server run reaches these commands.
