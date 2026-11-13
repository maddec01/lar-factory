Ported from mattpocock/skills (skills/productivity/handoff/SKILL.md); see UPSTREAM.md.

# Handoff

Write a continuation summary naming the work ID and current stage, decisions
and missing work. Reference existing specs, records, commits, diffs and ADRs by
path/URL/ID instead of copying them. Include suggested skills for the next agent
to invoke. Redact secrets and personal information. Use the user's arguments
to focus the continuation. Put the summary after the new thread's first line.

- Shaping: launch with `t3_thread_launch` in the repository project, first line
  `/lar-shape <work ID>`, `workspaceStrategy:{"type":"root"}`.
- Build: follow `lar-build/stages/handoff.md` for settling tasks, preserved build
  and review state, message and workspace strategy. Slice records carry slice
  details. Live task IDs are not reusable in the continuation.
