# Execution protocol

Server callers use `readExecution` for bounded thread-ID lookup and
`subscribeExecution` for retained timestamped thread projections. Both reuse
`ProjectProtocol.subscriptionSession` and the project Effect RPC ticket transport.
`readThreadFamily` reads active family shells. `subscribeExecutionShell` reads
projects, active threads and archived threads. Consumers must check availability
before treating a retained observation as current. Neither failure nor an empty
family establishes deletion. ADR 0033 still governs deletion confirmation.

The pinned contract is pingdotgg/t3code 97e35bcf23e4dcf34c2dcffadd37c08db0e01e52,
nightly 0.1.6-nightly.20261030.3917. Source pointers are
packages/contracts/src/orchestrationV2.ts:1974, 2176, 3617, 3650 and 3832, and
packages/contracts/src/rpc.ts:1810. Projection entity records remain opaque after
array and envelope validation. Following consumers must validate the fields they
consume. Runs, attempts, subagents, provider turns, runtime requests and messages
are included. Shell records carry worktree and PR context where populated.
Azure policy evaluations and reviewer votes are unsupported. The adapter does
not count tokens. Existing SQL association, transcript mapping and stats reads
remain until #708 and #709. Launch behavior remains #710.

Reconnect obtains a fresh ticket and snapshot. Unknown or incremental execution
events request a fresh snapshot by reconnecting rather than guessing reducers.
Failures retain the observation and its time. Stale snapshots are ignored;
equal-sequence projection fragments retain entities by ID.

Runtime evidence on 2026-10-31, local server port 3773: the board's separate
Keychain session authenticated two thread subscriptions with a forced disconnect
between them. Both returned thread 7890e962-9472-4a5d-bd99-91a9bc0aeeb9 at
sequence 219530. Two calls through `readExecution` returned available and matched
that ID; `readThreadFamily` returned available with one member. A separate shell
probe reconnected successfully. Real credential rejection, renewal failure and
server restart were not exercised. Probe scripts live in /tmp and contain no
credentials; credentials were read directly from Keychain into process memory.
