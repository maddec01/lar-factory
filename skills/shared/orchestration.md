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
- Top-level threads are a different thing: the board starts shaping, decision
  and build threads, and a thread uses `t3_thread_launch` only for its own
  handoff.
- Every prompt names the work ID it serves and carries the factory report
  rule: ≤300 words, no whole files, logs or screenshots.

## Roles

- **Implementer**: worktree child task; it first runs
  `git switch -c <given name> <build-branch>`, the slice branch name the builder
  gives it.
- **Prototype**: worktree child task; its local commit may be stale, so it
  first runs `git fetch origin main` and
  `git switch -c prototype/<slug> origin/main`, the slug a few words of
  the question. It returns each variant's start command (or
  HTML path), the worktree path, the branch and a preferred port, and leaves no
  server running ([SKILL.md 2. Size up](../size-up.md)).
- **Planner, reviewers, checks** and every other role: native subagent, unless
  model options make it a child task.
