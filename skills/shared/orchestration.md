# Orchestration

**Run contract.** With a board-supplied run ID, launch every role with
`lar-work role-launch WORK_ID --run-id RUN_ID --role ROLE --capabilities F --task F`
and pass its JSON to `delegate_task` unchanged. Save `orchestrator_capabilities`
JSON to F first (search omitted models); the task file holds the role's brief.
When the child finishes, run `lar-work role-finish WORK_ID --execution-id ID`
with T3's task result JSON on stdin (or `--file F`). If either command exits
non-zero, stop; cancel a mismatched active child. Never substitute.

T3's orchestration instructions take precedence. Without a run ID, use native subagents unless
another provider, requested model options or an isolated worktree require
`delegate_task`. Call `orchestrator_capabilities` once before the first child.
Put settings in `target.options`; compare returned provider/model/options with
the request. Report mismatches and wait for resolution; never substitute.
Preserve choices through retries and handoff.

Pass each role its instruction path, work ID, repository, exact data folder/CLI,
required evidence and this guide, including **Wait for delegated work**.
Report in plain active sentences and consistent project terms. Cite evidence
and uncertainty; omit filler, praise and generic conclusions. Use sentence-case
headings, straight quotes and restrained formatting. Return at most 300 words
and paths instead of whole files, logs or screenshots. Authors of
repository prose additionally read [Write prose](write-prose.md); editing agent
documents also loads [Write agent docs](write-agent-docs.md). Reports, findings, research notes and slice briefs use these prose rules.

Track children by `taskId`; follow their returned `next`. Cancel replaced or
unneeded tasks with `task_cancel`. Follow-up work uses a
new `delegate_task` with the earlier brief and findings, never `childThreadId` as
a conversation. Commit before worktree delegation, which starts from the local
commit. Top-level handoffs, including concept-to-decision, follow
[Thread ownership](issue-tracker/work-records.md#thread-ownership): reuse owners;
otherwise record the intent before launch and resolve it to the returned thread.
Roles never own that stage.

## Wait for delegated work

Roles run each heavy command separately as `lar-work heavy -- <command>`, in
the foreground with the longest tool timeout. Heavy means a whole suite,
production build, performance measurement or expected runtime over a minute.
`run-check` supplies its own slot. Waiting for a slot counts toward timeout.
Send no message until work and descendants finish; the last message is the report. If a tool backgrounds an
unfinished command, end silently and resume on completion. If it kills the
command, report unfinished, never passed; do not retry it. The owner decides.
Research may run in the background while its owner continues. UI reviewers may
leave only the app processes listed in their report running.

Before acting on a completion notice, read `task_status`. With
`hasPendingChildRuns:true`, wait for the next notice without polling, even if
status is completed and a result exists. For native roles, judge the report
directly. An interim message is not a result: request completion once, telling
the role to wait for its running command, not restart it. Child follow-ups use
a new delegation. A second unfinished report goes to recovery.

## Recover unfinished work

Read what an ended, errored or cancelled role left. Separate proven work from
missing work; delegate only the latter. Reuse results on an identical tree, or
after inspecting the intervening diff and explaining why it cannot affect them.
Otherwise rerun that part. Full checks, approver and re-slicing retain their rules.

## Worktree roles

Implementers first run `git switch -c <given name> <build-branch>`.
Prototype children first fetch the resolved remote default branch and create
`prototype/<slug>` from that tip. They return branch, worktree, preferred port
and each variant's command or HTML path, leaving no server running.
