# Handoff

post a handoff written per
  [handoff](handoff-content.md) as an issue comment, then continue in a
  fresh thread with `t3_thread_launch`.
  - Shaping thread: `/lar-shape <issue>` in the issue's repository project,
    `workspaceStrategy` `{"type":"root"}`.
  - Build thread: follow the handoff paragraph under **Build** in
    `lar-build`'s `agents/builder.md`. It says when to hand off, the message
    and `workspaceStrategy`, and the fields the handoff carries; a sliced
    build's open slice sub-issues carry the rest.
