# Reconcile the group

After every answer, gate, scope/contract change, set-aside, merge-build or observed
merged PR, find the owning concept or linked-work parent and run
`lar-work reconcile GROUP_ID`. Repeat after repairs until `items` is empty.

Work through its exact checklist and `before`/`after` sources. Within the approved
destination, retitle, merge or set aside proposed builds and fix briefs, current
answer references, blockers, Dependencies, release steps and map narrative. Never
ask whether to keep work the concept already settles. Ask only for a new product
choice, expanded scope or changes to active builds; retain their frozen input.

For each affected brief, use `doubt-package`, code evidence and the canonical
[gate](../gate.md): rerun Doubt after all source edits, then request Pedro's
Approve brief(s) on the board only for gates needing approval. Set Needs you with
the Questions wait command and stop; resume this checklist after approval.
The last approved ticket Spec stays visibly out of date until re-gated.

Record ordering edges or Doubt's current reason for each overlap. Record release
order in `set-release-plan GROUP_ID --revision N --file F`; a step's `shipsWith`
list names its delivery work IDs. Set `who` to `Pedro` for a human step or `Agent`
for an automated step; never use a placeholder such as `Release owner`.
Use `complete-release-step` for release evidence,
separate from PR merges, then the recorded Outcome check.
Save the map after current answers and drafts so their incorporation is recorded.
For a reviewed source-change item run `lar-work resolve-reconcile GROUP_ID
--item KEY --digest H --evidence "what was checked/fixed"`. Mechanical holds
cannot be checked off: repair their records and rerun. A stale digest requires a
reread and reconsideration. Report unresolved ticket-write failures explicitly.
