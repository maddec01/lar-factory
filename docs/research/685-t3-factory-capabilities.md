# T3 capabilities the local factory can reuse

Research for [#685](https://github.com/maddec01/lar-factory/issues/685), under the [active #653 map](https://github.com/maddec01/lar-factory/issues/653), inspected on 2026-10-30. This note supplies evidence and recommendations for #686. It does not settle that decision or product behavior.

## Findings

T3 already owns agent execution, conversations, child tasks, managed worktrees and several PR associations per thread. The board can use its documented CLI and outside-client MCP without keeping an agent turn running. Rich progress, PR details and subscriptions also exist in T3's first-party HTTP and WebSocket interfaces. Those interfaces require a different authentication audience from MCP and a client compatible with T3's protocol. An agent tool description alone proves neither access nor compatibility. [CLI implementation][cli], [outside clients][outside], [authentication][auth], [RPC contracts][rpc].

Recommendation: retain factory-specific local work records, refer to T3's IDs for execution and PR context, and avoid building a second thread, delegation, worktree or PR monitoring system. Use the documented CLI/MCP where sufficient. Evaluate the first-party client protocol for richer reads behind one version-aware adapter before replacing existing database reads. Keep provider reads limited to ticket context and facts T3 omits. These are recommendations, not approved implementation choices.

## Evidence and limits

- The installed `t3 --version` reported `0.1.6-nightly.20261030.3917`. Its bundled package metadata identifies commit [`97e35bcf23e4dcf34c2dcffadd37c08db0e01e52`](https://github.com/pingdotgg/t3code/commit/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52), committed 2026-10-30 at 06:51:36 UTC. All T3 source links below pin that revision, rather than moving `main`. The launcher uses the installed desktop bundle. It is not an independently versioned third-party CLI.
- Local read-only verification covered CLI help, a project-scoped `thread list --json`, and `thread show <id> --messages 0 --json`. List succeeded and returned a JSON array. Show succeeded and returned `{thread, messages}`, with no messages requested. Both expose status, lineage and PR summaries; show additionally exposes branch, worktree, active run and pending-request count. No local identifiers, conversation text or paths are reproduced here. [Owning implementation][cli].
- The external MCP access rules, HTTP endpoints, RPC schemas, provider adapters and recovery behavior below were verified in owning source. A separate unattended board MCP client, a paired RPC client, provider-specific live calls and restart experiments were not run. Source-verified availability is distinguished from this live CLI check throughout.
- Factory baseline is [`571b9f7ff9085f12d7b7df701058f28cd1024063`](https://github.com/maddec01/lar-factory/commit/571b9f7ff9085f12d7b7df701058f28cd1024063), fetched from `origin/main`. Existing [#680 workflow research](https://github.com/maddec01/lar-factory/issues/680#issuecomment-6532714004) and [#684 permission research](https://github.com/maddec01/lar-factory/issues/684) are inputs. Their implementation recommendations are not decisions here. The parent's active boundary supersedes its collapsed history.

## Interfaces a board server can use

| Interface | Access outside an agent turn | What it provides and what it omits |
| --- | --- | --- |
| Documented `t3 thread` CLI | Yes. Live list/show reads verified. The CLI discovers the local running server and issues and revokes its own short-lived MCP client session. | `list`, `show`, `start`, `send`; JSON output; `start --worktree <base> --branch <name>`; optional provider/model; `--wait` distinguishes completion, failure and human input. No CLI PR commands or streaming progress command appear in installed help. [Source][cli]. |
| Authenticated HTTP MCP at `/mcp` | Yes. Officially documented for outside agents and bots. Source verifies project/thread reads and target-thread operations. | OAuth approval grants read-only access or a runtime-mode ceiling. Explicit `projectId`/`threadId` replace caller-thread defaults. Project list, thread list/read, pending questions, PR link/list and worktree list need no active caller turn. Writes require an appropriate grant. [Docs][outside], [authenticator][oauth], [access declarations][access]. |
| T3 first-party HTTP API | Yes with a standard environment client session, not an MCP-client token. Source verified, not exercised here. | `GET /api/projects`, `/api/orchestration/shell`, `/api/orchestration/threads/:threadId`, and transcript, bounded-snapshot and history routes. These return typed project/thread records. The PR HTTP group provides a diff endpoint, not a general REST PR status API. [HTTP contracts][http], [handlers][orchestration-http]. |
| T3 first-party WebSocket RPC | Yes with a standard environment client session and compatible protocol. Source verified, not exercised here. | `orchestration.subscribeShell`, `orchestration.subscribeThread`, thread-family reads, VCS/worktree operations, `pullRequests.summary`, `.detail`, `.checks`, `.activity`, `.stack`, `.linkedThreads` and `.subscribeRefreshes`. T3's own client uses Effect RPC with JSON serialization, not arbitrary JSON-RPC messages. [Contracts][rpc], [orchestration contracts][v2], [client session][rpc-session]. |
| T3's internal SQLite projections | The factory currently opens them read-only. This is an internal dependency, not a supported integration contract. | Existing queries supply projects, thread attribution, turns, waits, subagents and transcript mapping. Read-only access prevents writes but does not stabilize names or semantics. [Factory reader][factory-db], [ADR 0005](../adr/0005-read-item-stats-from-t3s-database.md). |

The CLI itself is a concrete example of non-agent access to MCP. Its implementation creates a full-access machine-owner client session, calls `/mcp`, and revokes the session on exit. That does not make its session a reusable board credential. The documented route for a long-lived outside MCP client is OAuth. Token renewal, expiry and revocation need testing before adopting it for unattended use. [CLI session lifecycle][cli], [outside-client docs][outside].

MCP and first-party client credentials are separate. A session with subject `mcp-client` is rejected by other HTTP and WebSocket routes. Rich subscriptions therefore cannot be obtained by attaching the MCP bearer token to a socket. Standard environment sessions, scoped bearer issuance through `t3 auth session issue`, and WebSocket tickets exist. They require their own local credential lifecycle. No credential should enter repository config or public research. [Authentication design][auth], [auth CLI][auth-cli], [RPC authorization][rpc-auth].

This is evidence of first-party interfaces, not a promise of a stable third-party SDK. The source contains typed contracts and client compatibility machinery, but this research found no published compatibility guarantee for an external board client. Prefer the documented CLI/MCP contract where it covers the requirement; treat direct first-party protocol use as a deliberate versioned dependency.

### Tools that still need a caller thread

`delegate_task`, `task_status`, `task_cancel`, `create_threads` and `t3_background_wait` use `actsAsCaller`. Delegation additionally requires an active parent run belonging to the calling provider session. Passing a parent ID from an ordinary outside MCP client does not impersonate that parent. The builder can delegate inside its T3 run; the board can observe its records. [Handler declarations][orchestrator-handlers], [delegation implementation][orchestrator-service].

`t3_worktree_handoff` and `t3_worktree_status` act on the calling thread and require its credential. In contrast, `t3_worktree_list` is declared as a read and accepts a target thread ID. Outside clients receive the worktree capability. It lists refs and checkout paths; the tool contract excludes detached worktrees without a branch. Thread show/snapshot also supplies the attached path and branch. [Worktree handlers][worktree-handlers], [handoff service][worktree-service], [outside capabilities][oauth].

PR link, unlink, list, watch and unwatch handlers accept an explicit `threadId`. Link/watch mutations check client access and the target's permission ceiling, rather than requiring an active caller run. A subagent target cannot watch. A board can technically control a top-level thread's watch, but that watch wakes an agent and is not a passive board subscription. [PR handlers][pr-handlers]. No watches were started during this research.

## Work, threads and child progress

T3 has project IDs, thread IDs, run IDs and task IDs. Its thread records contain parent relationships, branch/worktree metadata and PR links. The inspected contracts do not define the factory's work ID, Status, refinement outcome, build phase, slice acceptance or review finding lifecycle. A T3 queued message is a future conversation turn, not the factory Queue of work. [Thread contracts][mcp-contracts], [orchestration records][v2].

An app-owned delegated task records its origin, parent node/run, child thread, status, optional progress text, result and completion delivery. Native subagents use the same projection with `origin: provider_native`; a child thread is nullable. Some provider integrations expose only task cards. Do not assume every task has a backing conversation or that every native tool reports equal detail. [Subagent schema][v2], [provider behavior][orchestration-doc].

For observation without a parent credential:

- MCP `t3_thread_list` can include subagents and exposes lineage and latest status. `t3_thread_read` with `view: activity` pages timeline items with status, run and subagent IDs. It is an observation route, not the parent's durable `task_status` result contract. [MCP schemas][mcp-contracts], [read implementation][orchestrator-service].
- First-party thread snapshots and `subscribeThread` expose structured subagent records, including optional progress and result. Shell subscriptions can omit idle child threads and older settled threads; callers must fetch thread families or older pages when using those options. A partial shell is not a complete work history. [Snapshot and subscription schemas][v2].
- The documented CLI's show command reports pending-request count and recent conversation messages. It does not expose the full structured task roster. Its implementation currently reads the paginated conversation before selecting the latest messages, even for `--messages 0`; frequent per-thread use may cost more than its small output suggests. [CLI show implementation][cli].

Recommendation: associate a local work record with explicit T3 thread/run/task IDs as work starts. Use T3 status for execution facts, such as running, waiting or interrupted. Keep factory acceptance and review outcomes in factory records. A completed agent turn does not prove a passing brief, completed slice or deliverable PR.

## PR associations and discovery

There are three different associations to preserve:

1. `branchPullRequest` comes from discovery for a thread's recorded branch and repository identity. Discovery reacts to thread creation, metadata changes, checkpoints, unsettlement and run completion. A periodic sweep also exists, but opportunistic work depends on server activation policy. Ambiguous remotes and fork branches can need an upstream. This is branch context, not proof that every PR belonging to factory work was found. [Discovery service][discovery].
2. Explicit `pullRequests[]` links use host, repository and PR number, plus URL and source. T3 Git actions link created PRs. A reactor can recognize completed shell create commands and their output URLs, then record links. It deliberately rejects ambiguous output. Commands hidden behind scripts or unusual output are not guaranteed to be detected. [Git-action linking][created-link], [command detector][pr-sync].
3. Provider ticket-to-PR relationships belong to GitHub or Azure DevOps. A T3 thread link does not create a closing reference, and a closing reference does not identify a factory work record or guarantee a T3 thread link. [GitHub issue relationships][github-issues], [Azure work-item relations][azure-work-item].

Users can link PRs through T3's first-party UI. The board or agent can explicitly link known URLs through MCP. `list_thread_pull_requests` returns last-known state, source and stack position, not fresh checks or complete reviews. Thread list/read also carries compact PR links with nullable state. Use the array rather than the legacy singular `linkedPullRequest`. [PR handlers][pr-handlers], [link schema][pr-link-schema], [MCP schemas][mcp-contracts].

A thread can hold several PRs and unrelated PRs. Native stack metadata groups provider layers; branch relationships can also form inferred chains. Stack siblings discovered during sync can be added with source `stack`. Unlinking a stack member records `stack-dismissed` so later sync does not silently restore it. [Stack grouping][pr-chains], [stack sync][pr-sync], [link model][pr-link-schema]. Several links or a stack are not evidence that one factory build should deliver several PRs. That remains a factory decision.

Recommendation: store normalized external PR references on the local work record and ensure intended T3 links exist. Use automatic discovery as help with recovery, not the sole association mechanism. Preserve all relevant references when work uses several threads or stack layers. Which PRs determine work completion remains open for #686.

## PR facts, updates and restart behavior

T3's thread-link snapshot stores state, draft flag, branches, sync time and optional close/merge time, check summary, review decision and mergeability. The compact MCP list does not return all those fields. Rich first-party PR RPCs provide summary, checks, detail and activity independently, with capabilities and observation times where defined. The GitHub provider implements check reads, reviews and stack reads. [Snapshot schema][pr-link-schema], [PR contracts][pr-contracts], [GitHub implementation][github-provider].

First-party merge/close/reopen operations also exist through `pullRequests.runAction`, subject to provider capability and authorization. Technical availability does not authorize a factory agent to merge. [RPC operations][rpc], [ADR 0002](../adr/0002-the-user-merges-every-pr.md).

T3 can auto-settle a thread once every linked PR is terminal, when that preference is enabled. An open or unsynced link prevents it. Terminal includes closed-unmerged PRs, so settlement cannot stand in for a successful factory build. [Linked PR behavior](https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/docs/user/source-control.md#linked-pull-requests).

T3's linked-PR sync is provider polling followed by local events. At this revision it sweeps each minute, slows open PRs quiet for 30 minutes to five-minute reads, and reads closed PRs at a 15-minute cadence. Explicit requests bypass normal cadence. Settled threads stop ordinary refreshes; merged snapshots with merge time need no ordinary reread. Reopening or correcting a terminal record may therefore require a requested refresh. Failures and rate limits can leave the last snapshot visible. [Due rules and reactor][pr-sync].

There are two different update consumers:

- A passive first-party client can observe thread/shell changes and PR refresh invalidations. `pullRequests.subscribeRefreshes` sends a numeric invalidation value, not a complete per-PR event record. Read the relevant PR again. `PullRequestService.subscribeMerges` and `.subscribeStateChanges` are in-process Effect streams, not independently advertised external endpoints. [RPC subscription][rpc], [service boundary][pr-service].
- A PR watch periodically reads provider facts and wakes its owning agent on actionable changes. It persists watch baselines and stops on terminal PR state, thread stop/settlement/archive and bounded failure conditions. It is useful for an agent asked to continue handling a PR; it should not be required just to refresh the board. [Watch reactor][pr-watch], [persisted watch model][pr-link-schema].

Subscriptions are local event delivery, not proof of a GitHub or Azure webhook feed. No direct provider push contract was established by this inspection. The board must account for T3's polling cadence and unavailable/stale observations.

T3 persists events and projections for threads, tasks, PR links, snapshots and watch baselines. Runtime credentials and process handles are not durable work. Startup recovery reconciles lost provider work and requests; eligible threads can receive a continuation when the relevant setting permits it. Native subagents interrupted by restart may need to be restarted. App-owned children recover in their own threads and report back. This is recovery policy, not a guarantee of uninterrupted execution. [Projection store][projection], [runtime recovery][recovery], [continuation policy][continuation].

First-party subscription inputs carry `afterSequence`, and snapshots carry `snapshotSequence`. Bounded history uses opaque cursors. Reconnect by reading a fresh snapshot or using the supported sequence protocol, rather than keeping a socket event as the only record of completion. Exact restart/replay behavior for a new board client remains untested. [Subscription schemas][v2].

The factory still needs durable launch intent and association recovery. The current CLI start interface has no caller-supplied idempotency flag, while MCP send/launch contracts support request IDs. MCP launch derives IDs from the caller's request namespace and key. Outside clients use a session-specific namespace, so the same key under a newly issued session is not a proven cross-session retry guarantee. [Launch handler][project-handlers], [client namespace][oauth]. A timeout is not evidence that nothing started. After restart, reconcile recorded IDs before launching again; deletion, temporary absence and an unavailable T3 server are different facts. This follows the existing [ADR 0033](../adr/0033-confirm-a-deleted-thread-through-the-t3-cli.md) and [factory lookup behavior][factory-t3]. The exact local journal and retry policy belong to #686.

## GitHub and Azure DevOps

Both providers are implemented in the inspected T3 revision. Azure is not an unsupported-host gap. The remaining differences concern what each adapter returns. [Registry][pr-registry], [GitHub provider][github-provider], [Azure provider][azure-provider].

| Fact or operation | GitHub in T3 | Azure DevOps in T3 |
| --- | --- | --- |
| PR identity, state, draft, branches, merge/close time | Implemented | Implemented; active/completed/abandoned map to open/merged/closed |
| Checks | Dedicated checks reads and check details | No dedicated checks reader; detail returns an empty checks array |
| Review status | Review decision and review activity | Reviewer identities are read, but the decoder does not preserve votes or derive a review decision |
| Comments and review threads | Read and write operations | Conversation comments can be read; activity returns no structured review threads or commits; comment/review mutations are unsupported |
| Stack | GitHub native stack reader plus shared chain model | No Azure native stack reader found; shared branch-chain inference is not provider stack evidence |
| Merge/close and permission evidence | Actions with provider/viewer permissions | Actions, including auto-complete, exist; advertised viewer permissions mirror capabilities rather than a per-PR permission lookup |

Sources: [GitHub provider][github-provider], [Azure provider][azure-provider], [Azure decoding][azure-json], [common PR service][pr-service]. An empty Azure checks array is not evidence that required policies passed. Microsoft separately exposes [policy evaluations][azure-policy], [PR statuses][azure-statuses] and reviewer votes in [PR reads][azure-pr]. Azure cross-repository PR links additionally require a T3 project checked out from the matching organization and repository. [PR project resolution][pr-handlers].

T3 can use GitHub credentials saved in its own settings or environment before falling back to the local `gh` login. The factory currently uses `gh` directly. Azure T3 reads use `az` and its DevOps extension. A T3-visible result and a factory provider read can therefore differ in account or access; an adapter should not silently treat them as equivalent authentication. [GitHub credential order](https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/docs/user/source-control.md#github), [Azure CLI implementation][azure-cli], [factory ADR 0001](../adr/0001-use-the-local-gh-login.md).

### Smallest remaining provider reads

Recommendation, conditional on adopting T3's rich first-party reads:

- Read selected tickets' title, description, state, assignees and relevant relationships from their provider. T3's inspected thread/PR contracts do not supply a general ticket/backlog API. GitHub's issue relationships can identify linked PRs; Azure work items can expand relations. Do not require a whole team-board read merely to refresh local factory progress. [GitHub schema][github-issues], [Azure work-item API][azure-work-item].
- For linked GitHub PRs already covered by T3, reuse T3 state/check/review reads. Provider reads remain necessary for ticket association, inaccessible/missing T3 context, or a deliberate fallback while rich RPC integration is unverified. A targeted `gh pr view <url> --json ...` can request state, head SHA, merge state, checks and reviews. [GitHub CLI reference][gh-pr-view].
- For Azure, read policy evaluations when policy readiness matters, and PR statuses when external checks matter. One targeted raw PR read can supply reviewer votes T3 discards. Read work-item relations only when ticket context needs them. These are distinct facts; `mergeStatus` alone does not replace policy and review evidence. [Policy API][azure-policy], [status API][azure-statuses], [PR API][azure-pr].

If the board uses only documented CLI/MCP, its PR summaries are insufficient for detailed readiness on either provider. Targeted provider PR reads are then still needed. Choosing that smaller integration is a tradeoff, not an absence of rich data inside T3. No additional provider writes are needed to report local factory progress.

## Existing factory integration and remaining local records

The current implementation already separates its T3 launcher from provider adapters, but it still derives factory identity and progress from tickets:

- `src/t3/t3.ts` starts threads and creates projects through the CLI, handles uncertain starts and confirms unavailable threads. `repository-project.ts` reads projects from the internal database, then matches main checkouts by git origin. A documented MCP project list or the first-party project API could replace project SQL while retaining factory repository matching. [Launcher][factory-t3], [project lookup][factory-projects].
- `src/t3/t3-db.ts`, `t3-reads.ts` and `src/threads/item-threads.ts` read internal tables and infer issue ownership from the first user message. The parser recognizes factory work/build messages with repository and issue number. This cannot identify ticketless work and is not an explicit T3 work association. Token/cost totals additionally read provider transcripts under ADRs 0007 and 0008; proving parity with a public usage interface was outside this question. [DB reader][factory-db], [read coordinator][factory-reads], [attribution][factory-threads].
- `src/items/item-source.ts` combines provider item listing with factory Status writes; `item-commands.ts` uses provider-backed items for Queue and Start. Its in-flight maps are not a general durable local workflow store. [Source interface][factory-items], [commands][factory-commands].
- GitHub currently reads issue-to-PR links and checks itself, with a fixed first-five PR relationship query. Azure follows work-item artifact links and reads each PR; its adapter explicitly omits checks. Those are current factory limits, not limits of GitHub, Azure or all T3 interfaces. [GitHub query][factory-github], [Azure PR adapter][factory-azure].

Given the confirmed local boundary, #686 still needs to decide a durable factory record for:

- A local work identity, repository reference and optional published ticket references.
- Status and Queue membership, refinement content and outcomes, dependencies, build phases, slices, review rounds and unresolved findings.
- Associations with T3 project/thread/run/task IDs and intended deliverable PR references, including provenance when recovered through discovery.
- Launch intent, retry/recovery information and publication attempts that must survive a board restart or a partly successful provider write.

This list describes missing factory facts, not a proposed storage schema. Cache T3/provider observations only as observations with availability and freshness. T3 can remain authoritative for execution; providers can remain authoritative for tickets and PRs; the machine's factory records hold factory progress. Which transitions consume those observations remains undecided.

## Questions for the next decision and verification

1. Is documented CLI/MCP with targeted provider reads sufficient, or should the board adopt T3's first-party client protocol for structured tasks, rich PR reads and subscriptions? The latter is source verified but needs a small read-only compatibility/authentication trial.
2. How should a board client renew and recover its own credentials without using an agent session? Test OAuth expiry/revocation separately from standard-client pairing and socket-ticket renewal. No approval or credential setup was exercised here.
3. What local launch intent and stable request ID prevent duplicates when the board crashes after T3 accepts work? How are deleted threads, removed worktrees and old associations retained? Do not resolve absence as deletion during outages.
4. Which PRs and review outcomes affect a build, especially with several threads, unrelated links, stacks or closed-unmerged PRs? T3's settlement preference is not a factory completion policy.
5. Verify Azure policy/status/vote reads against an authorized fixture before treating them as readiness evidence. No live Azure project was accessed. Verify fork ambiguity, wrapped creation commands, stack updates and missed subscription recovery before relying on automatic association.

## Domain docs implications

No terms or ADRs are changed by this research. The parent's draft Status, Build and local-progress ADR remain the decision inputs. T3 execution state, thread settlement, provider ticket state and PR state should remain distinct in their wording.

The local-progress ADR will supersede ADR 0020 and requires reviewing ADRs 0023 to 0025 as the parent already records. Also revisit ADR 0004's provider sub-issues for slices, ADR 0017's issue-driven starts, ADR 0028's polling responsibilities, ADR 0005's database dependency and ADR 0033's deletion confirmation when the selected integration is known. ADRs 0006 to 0008 still describe execution/statistics concerns that can remain separate from local work identity. Existing glossary terms Item thread, Work message, Slice, Item stats and Done depend on ticket attribution or closure and need review. None of those implications decides replacement wording here.

[cli]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/cli/thread.ts
[outside]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/docs/user/outside-agents.md
[auth]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/docs/internals/environment-auth.md
[oauth]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/auth/McpOAuth.ts#L555
[access]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/McpToolAccess.ts
[auth-cli]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/cli/auth.ts#L169
[rpc-auth]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/auth/RpcAuthorization.ts
[http]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/contracts/src/environmentHttp.ts
[orchestration-http]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/http.ts
[rpc]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/contracts/src/rpc.ts
[rpc-session]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/client-runtime/src/rpc/session.ts
[v2]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/contracts/src/orchestrationV2.ts
[mcp-contracts]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/contracts/src/orchestratorMcp.ts
[orchestrator-service]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/OrchestratorMcpService.ts
[orchestrator-handlers]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/toolkits/orchestrator/handlers.ts
[project-handlers]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/toolkits/project/handlers.ts
[orchestration-doc]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/docs/orchestration-v2/orchestrator-mcp-server.md
[worktree-handlers]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/toolkits/worktree/handlers.ts
[worktree-service]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/WorktreeMcpService.ts
[pr-handlers]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/mcp/toolkits/pullRequests/handlers.ts
[pr-link-schema]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/contracts/src/threadPullRequest.ts
[pr-contracts]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/contracts/src/pullRequest.ts
[discovery]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/ThreadPullRequestService.ts
[created-link]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/git/linkCreatedPullRequest.ts
[pr-sync]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/PullRequestSyncReactor.ts
[pr-watch]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/PullRequestWatchReactor.ts
[pr-chains]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/source-control-core/src/shared/threadPullRequests.ts
[pr-service]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/pullRequest/PullRequestService.ts
[pr-registry]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/pullRequest/PullRequestProviderRegistry.ts
[projection]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/ProjectionStore.ts
[recovery]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts
[continuation]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/apps/server/src/orchestration-v2/RestartContinuation.ts
[github-provider]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/source-control-github/src/server/GitHubPullRequestProvider.ts
[azure-provider]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestProvider.ts
[azure-json]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/source-control-azure-devops/src/server/azureDevOpsPullRequestJson.ts
[azure-cli]: https://github.com/pingdotgg/t3code/blob/97e35bcf23e4dcf34c2dcffadd37c08db0e01e52/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestCli.ts
[github-issues]: https://docs.github.com/en/graphql/reference/issues#issue
[azure-work-item]: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1
[azure-policy]: https://learn.microsoft.com/en-us/rest/api/azure/devops/policy/evaluations/list?view=azure-devops-rest-7.1
[azure-statuses]: https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-statuses/list?view=azure-devops-rest-7.1
[azure-pr]: https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1
[gh-pr-view]: https://cli.github.com/manual/gh_pr_view
[factory-t3]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/t3/t3.ts
[factory-db]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/t3/t3-db.ts
[factory-reads]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/t3/t3-reads.ts
[factory-projects]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/t3/repository-project.ts
[factory-threads]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/threads/item-threads.ts
[factory-items]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/items/item-source.ts
[factory-commands]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/items/item-commands.ts
[factory-github]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/github/github.ts
[factory-azure]: https://github.com/maddec01/lar-factory/blob/571b9f7ff9085f12d7b7df701058f28cd1024063/apps/server/src/azure/azure-prs.ts
