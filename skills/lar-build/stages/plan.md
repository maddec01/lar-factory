# Plan

Input: record, approved brief, initial context and existing slices. Output:
recorded Small build route or planner's private slices/blockers. Set phase `plan`.

1. Set **In progress**, unless a handoff resumes past **Build**. Read the
   ticket Spec through `lar-work gate <work ID>`, then its brief
   (`lar-work body <work ID> --body brief`) and record (`lar-work read`),
   its initial context (`lar-work context`), the prototype or research branches
   the brief names, existing project instructions when present and `<lar-build>/project-rules.md`;
   follow existing worktree instructions if present. When no instructions exist,
   infer setup and checks from package scripts, manifests, CI and nearby code.
   Missing factory setup or agent instruction files never block a build.
   Follow [Ticket Specs](../shared/issue-tracker/ticket-specs.md).
   Inspect the gate's Spec sync warnings. If the ticket read failed, report
   that this build uses the last local copy. Held GitHub edits need the user's
   Accept or Reject in details before use. Later tracker edits update the
   record and leave the running build as it started.

Require explicit approval of the current brief digest before implementation.
A changed or unapproved brief follows [Recovery](recovery.md).
Retain the starting brief and frozen `lar-work run-settings <work ID> --run-id RUN_ID` through retries/handoff. `prepare-build` remains unavailable.

2. **Plan.** On a resume, a handoff that says `Small build` skips **Plan**:
   if the handoff says the change isn't done, finish it through [Implement](implement.md); otherwise go to the step the handoff names. A build that already
   has slices (`lar-work children <work ID>`) starts a re-slice planner if any
   unfinished slice is blocked, and goes to [Implement](implement.md).
   Otherwise decide whether this is a **Small build**: one change, or every
   part touches the same files. Keep the route in the thread and handoff.
   Small builds set phase `implement` and go to [Implement](implement.md) without a planner or slices.
   Other builds start [Planner](../agents/planner.md) with the work ID and repo
   path; its saved slice list goes to Implement.
