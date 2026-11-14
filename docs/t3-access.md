# T3 access and pending approvals

The factory follows T3's access setting. It has no access policy or Settings
control of its own. Shaping, concept, decision, build and retro owners use the
same board launch adapter; role overrides and reviewer settings change only the
model and effort.

## Launch API behavior

Verified against pingdotgg/t3code commit
[`7ae21bf164065506d27fb60bf8c1e5e1eac0af1a`](https://github.com/pingdotgg/t3code/tree/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a):

- The direct `orchestration.launchThread` RPC requires `runtimeMode` in
  [`OrchestrationV2ThreadLaunchInput`](https://github.com/pingdotgg/t3code/blob/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a/packages/contracts/src/orchestrationV2.ts#L3843).
  [`RuntimeMode`](https://github.com/pingdotgg/t3code/blob/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a/packages/contracts/src/providerPolicy.ts#L25)
  accepts four concrete modes, with no `inherit`. Omitting it is invalid.
- T3's [`resolveProjectOverrides`](https://github.com/pingdotgg/t3code/blob/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a/packages/shared/src/projectSettings.ts#L110)
  applies `projectSettingsOverrides[projectId].defaultRuntimeMode` over the
  environment's `defaultRuntimeMode`. T3's own schema fallback is `full-access`
  (`providerPolicy.ts`, `DEFAULT_RUNTIME_MODE`; `settings.ts`,
  `ServerSettings`). This is why current factory threads run full-access when
  Pedro has selected no narrower T3 default.
- The board's `apps/server/src/t3/model-choices.ts` mirrors that resolution,
  read-only. `t3.ts` forwards it for root, new-worktree and existing-worktree
  owners alike. `launch-thread.ts` passes the required concrete value and keeps
  the same request and command ID on replay. A replay does not change an
  existing thread's setting. Factory run settings never choose access.
- `delegate_task` supports omitted mode or `runtimeMode: "inherit"`.
  T3's [`resolveRuntimeMode`](https://github.com/pingdotgg/t3code/blob/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a/apps/server/src/mcp/delegatedTaskModes.ts#L31)
  uses the parent mode, refuses escalation, and narrows inherited access if the
  target provider cannot support it. `packages/work-records/src/role-command.ts`
  emits `inherit` for every role, including reviewers, Doubt and nested roles.
  `skills/shared/orchestration.md` also covers native roles and handoffs.
  Owners launched through T3 tools omit runtime overrides and follow T3's
  tool-specific inheritance rules.

## Display contract

`apps/server/src/t3/pending-request.ts` uses the shell's exact unresolved request
ID and owner. T3's shell exposes its kind, while the matching
[`approval_request` turn item](https://github.com/pingdotgg/t3code/blob/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a/packages/contracts/src/orchestrationV2.ts#L1783)
can supply `prompt` and `reason`. Only that display text and the owner title leave
the server; commands, arguments and runtime request payloads do not. Descendant
waits propagate through the existing question projection in `item-execution.ts`.
A replaced or resolved request cannot retain an old approval's summary.

The desk says Approval in T3 and links Answer in T3 to that exact owner. The
board sends no approval response. Brief and batch gates, Verify, release steps
and merges still require board actions.

## Isolated live S04 setup

Use a disposable sandbox T3 Project. In T3 Settings select only that project's
scope, then set its default permissions to approval-required. T3 exposes this
project-scoped `defaultRuntimeMode` override in
[`ProjectDefaultsSettings.tsx`](https://github.com/pingdotgg/t3code/blob/7ae21bf164065506d27fb60bf8c1e5e1eac0af1a/apps/web/src/components/settings/ProjectDefaultsSettings.tsx#L337).
Leave environment/global defaults unchanged. Start new factory work in that
sandbox through the board, using Codex gpt-6.1-sol with high reasoning effort.
Ask its owner or inherited Explore role to perform a harmless sandbox operation
that the provider requires approval for. Confirm the runtime in T3; observe the
owner, request and exact thread link on the desk. Approve or decline in T3 and
confirm the card clears when no other human wait remains. A provider that does
not request approval for that operation needs a different harmless operation;
absence alone is not a passed approval test. Remove the sandbox project override
and disposable work after the run. No global default change is needed.
