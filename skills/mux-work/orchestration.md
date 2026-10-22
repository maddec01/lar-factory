# Orchestration

How a factory thread delegates work. T3 Code's own orchestration instructions
are authoritative; this file maps factory roles onto them. Where they differ,
follow T3.

## Native subagent or child task

A **child task** is `delegate_task` work this thread owns and tracks by its
`taskId`. Start one when any of these holds; otherwise use a native subagent:

- the agent needs its own worktree (`isolation:"worktree"`);
- model options are requested for it;
- `orchestrator_capabilities` shows non-empty `inheritedOptions` for the same
  provider instance and model.

Put options in `target.options`. Check the returned provider, model and
options against the request; report a capability mismatch, never downgrade.

## Running a child task

- Track it by `taskId` with `task_status` and `task_cancel`. More work for it
  is a new `delegate_task` carrying the earlier brief and findings; its
  `childThreadId` is storage, never a conversation.
- Its worktree starts from this thread's local commit, without uncommitted
  edits: commit before delegating.
- Top-level threads (`t3_thread_launch`) are a different thing, only for
  shaping, decision and build threads and handoffs.
- Every prompt carries the factory report rule: ≤300 words, no whole files,
  logs or screenshots.

## Roles

- **Implementer**: worktree child task; it first runs
  `git switch -c slice/<n>-<m>-<slug> <build-branch>`.
- **Prototype**: worktree child task; its local commit may be stale, so it
  first runs `git fetch origin main` and
  `git switch -c prototype/<n>-<slug> origin/main`.
- **Planner, reviewers, checks** and every other role: native subagent, unless
  model options make it a child task.
