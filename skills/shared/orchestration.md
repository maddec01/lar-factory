# Orchestration

How a factory thread delegates work. T3 Code's own orchestration instructions
are authoritative; this file maps factory roles onto them. Where they differ,
follow T3.

## Native subagent or child task

**Run contract.** With a board-supplied run ID, launch every role with
`lar-work role-launch WORK_ID --run-id RUN_ID --role ROLE --capabilities F --task F`
and pass its JSON to `delegate_task` unchanged. Save `orchestrator_capabilities`
JSON to F first (search omitted models); the task file holds the role's brief.
When the child finishes, run `lar-work role-finish WORK_ID --execution-id ID`
with T3's task result JSON on stdin (or `--file F`). If either command exits
non-zero, stop; cancel a mismatched active child. Never substitute.

A **child task** is `delegate_task` work this thread owns and tracks by its
`taskId`. Start one when any of these holds; otherwise use a native subagent:

- the agent needs its own worktree (`isolation:"worktree"`);
- model options are requested for it.

Put options in `target.options`. Check the returned provider, model and
options against the request; report a capability mismatch, never downgrade.

## Running a child task

Call `orchestrator_capabilities` once per thread, before the first child task.
A thread that starts no child task makes no call.

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

## Wait for delegated work

Every delegated prompt, for a child task or a native subagent, carries this
guide's path and the instruction to apply this section.

A delegated role runs heavy commands in the foreground with its tool's longest
timeout. It sends no message until its work is done, and its last message is
the report. Time waiting for a heavy slot counts toward the tool's timeout.

If the tool moves an overrun command to the background, end the turn silently,
without a report or a "still running" message. Resume when the command finishes
and report after completing the work. If the tool kills the command at its
timeout, report it as unfinished, never as a pass, and do not retry it. The
owning thread decides what happens next.

Concept research decisions still start in the background so the owning thread
can carry on. Their roles follow the command and report rules above. A UI
reviewer may leave the app processes it lists in its report running.

Before merging or otherwise acting on a child task's completion notice, read
it with `task_status`. When `hasPendingChildRuns` is true, the task is
unfinished, even when `status` is `completed` and `workState` is
`result_available`. Take no action on that notice and wait for the next one,
without polling.

Then judge the report, also for native subagents, which have no task to read.
A message that does not state the result of the work, such as "still running",
is unfinished even when no child runs are pending. Ask the role once to finish,
telling it to wait for a running command rather than restart it. For a child
task, use a new `delegate_task` with the earlier brief and message, as above.
If the next message is still unfinished, follow **Recover unfinished work**.

## Recover unfinished work

When a delegated task ends, errors or is cancelled before finishing, read what
it left. List what is proven and what is missing, and delegate only the missing
part. An earlier result stays valid on the identical tree, or when you read the
diff since it ran and state why that diff cannot affect the result. Otherwise
rerun that part. The full check step, the approver and re-slicing a blocked slice
keep their own rules.

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
