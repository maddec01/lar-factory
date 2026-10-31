# Execution protocol

Server callers use `readExecution` for bounded thread-ID lookup and
`subscribeExecution` for retained timestamped thread projections. Both reuse
`ProjectProtocol.subscriptionSession` and the project Effect RPC ticket transport.
`readThreadFamily` reads active family shells. `subscribeExecutionShell` reads
projects, active threads and archived threads. Consumers must check availability
before treating a retained observation as current. Neither failure nor an empty
family establishes deletion. ADR 0033 still governs deletion confirmation.

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
until the T3 CLI confirms it deleted (docs/adr/0033). Stats use the same completed protocol observation.


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
