# Handoff

Write a handoff per [handoff](handoff-content.md), then continue in a fresh
thread with `t3_thread_launch`, the handoff following the first line of its
message.

- Shaping thread: first line `/lar-shape <work ID>`, in the work's repository
  project, `workspaceStrategy` `{"type":"root"}`.
- Build thread: follow the handoff paragraph under **Build** in `lar-build`'s
  `agents/builder.md`. It says when to hand off, the message and
  `workspaceStrategy`, and the fields the handoff carries; a sliced build's
  unfinished slice records carry the rest.
