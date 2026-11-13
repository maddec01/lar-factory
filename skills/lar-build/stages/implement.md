# Implement and integrate

Input: Small build route or saved slices/blockers and build branch. Output:
committed change or integrated and finished slices.

## Small build

Implement in the build worktree with [Test first](../test-first.md),
[Coding style](../coding-style.md), and [Design modules](../design-modules.md)
when a module's shape changes. Commit per project rules, run focused checks,
then continue to [Domain docs](domain-docs.md).

## Slices

Follow **Launch reporting and recovery** in
   `<lar-build>/shared/issue-tracker/slices.md`: reconcile before launch or
   resume, confirm phase `implement` before launching, and confirm each child's
   association before yielding. Handle failed writes there without redelegating.

   In parallel, start an **implementer** child task for each
   ready slice (the ready-slices command in **Slices**) not already running,
   while no planner runs, per **Implementer** in
   `<lar-build>/shared/orchestration.md`, and track it by its `taskId`. Give it
   [Implementer](../agents/implementer.md), the slice's work ID, its brief
   (`lar-work body <slice> --body brief`), the build branch and the full slice
   branch name. Derive the name from the slice work ID's first 8 characters `<id>` and a slug of the
   slice title. The first attempt uses `slice/<id>-<slug>`. When
   `git branch --list 'slice/<id>-*'` finds a branch, a restart (after a
   handoff, a re-slice or a retry) uses `slice/<id>-<slug>-<k>`, where `k`
   is the lowest number from 2 up for which that branch does not exist.
   A **re-slice planner** follows [Planner](../agents/planner.md), also given one blocked slice's work
   ID; run one at a time. When it returns its outcome, start one for
   another blocked slice if any, and run this stage again. If it fails
   (errors or returns no outcome), record the slice blocked again with its
   reason, start no planner for that slice again, and follow [Recovery](recovery.md).

## Integrate

As each implementer reports, merge its reported slice branch and
   finish its slice work ID here with this one command. It reads the revision
   when it runs and finishes the slice only after the merge exits 0:

   ```sh
   git merge --ff-only <slice branch> && lar-work finish <slice work ID> --revision "$(lar-work read <slice work ID> | jq -r .revision)"
   ```

   A parallel slice that rebased before another slice merged will fail to
   fast-forward. That failure is expected. When the command exits non-zero,
   read the error:

   - "Not possible to fast-forward": send a subagent to the implementer's
     reported worktree path to rebase onto the build branch tip, then run the
     same command again. It resolves rebase conflicts for the intent of both
     sides and runs focused tests on the conflicted code. If it can't resolve
     a conflict, it aborts the rebase and you follow [Recovery](recovery.md).
     A rebase conflict never starts a re-slice planner.
   - The merge landed and the finish failed: run the same command again,
     without a rebase.
   - "is already finished": the slice is done, so carry on.
   - Any other failure, such as a dirty tree or an unknown branch: follow [Recovery](recovery.md).

   After the slice is finished, run [Remove worktrees](remove-worktrees.md), then this stage
   again. A slice reported
   blocked gets the blocked-slice command in **Slices**, and a
   re-slice planner if none runs. A wrong brief follows [Recovery](recovery.md).
   Done when every slice is finished or set aside.
After all active slices finish or are set aside, continue to [Domain docs](domain-docs.md).
