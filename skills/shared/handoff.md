# Handoff

post a handoff written per
  [handoff](skills/handoff/SKILL.md) as an issue comment, then continue in a
  fresh thread with `t3_thread_launch`.
  - Shaping thread: `/lar-shape <issue>` in the issue's repository project,
    `workspaceStrategy` `{"type":"root"}`.
  - Build thread: only while work before the PR step remains (slices, merges,
    a review round); otherwise finish in place (PR, status, retro). Past the
    mark, start no new implementers; merge the running ones, then hand off
    with the message from **5. Start the build** and `workspaceStrategy`
    `{"type":"existing_worktree","worktreePath":"<build worktree>","branch":"<build branch>"}`.
    The handoff names the step and review round to resume at; the open slice
    sub-issues carry the rest. At a review round it also lists the round's
    base sha, each reviewer's verdict, open findings, fixed findings, and
    rejected findings with reasons, and the unreviewed fixes so far, each as
    the line the builder's **Approve** describes.
