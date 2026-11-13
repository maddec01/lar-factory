# Reconcile affected work

Input: group change or overlapping work. Output: coherent briefs, blockers,
Dependencies, tickets, map, current answers and release order; parts must agree.

After every group change (answers, scope/contracts, set-aside, merge-build,
single/batch board gates, observed PR merges), run `lar-work reconcile GROUP_ID`
on its concept or linked-work parent. Review the checklist's `before`/`after`
sources; repair and repeat until `items` is empty. Commands own mechanical checks,
invalidation and graph projection.

Check affected records and code across concepts and standalone work. Within the
approved destination, adjust proposed builds and repair stale briefs, answer
references, blockers, Dependencies, tickets and map. Reuse settled choices; ask
only for new product choices, expanded scope or changes to active builds.
Keep their frozen input; pause affected builds for a fresh gate. Preserve history
and unaffected approvals. Ungated scope stays local; the last approved ticket
Spec stays visibly out of date until re-gated.

Use `build-overlap` and `doubt-package`; record ordering or Doubt's current reason
for each overlap. After source edits, rerun Doubt and [Gate](../gate.md) for
affected briefs needing approval. Stop in Needs you through Questions for Pedro's
board approval, then resume reconciliation.

Save release order with `set-release-plan`: `shipsWith` names delivery work IDs;
`who` is `Pedro` for human steps, `Agent` for automated ones. Record release
evidence with `complete-release-step`, then the Outcome check; merges alone
prove neither. Save the map after current answers and domain drafts.

Resolve reviewed source changes with `lar-work resolve-reconcile GROUP_ID --item
KEY --digest H --evidence "what was checked/fixed"`. Repair mechanical holds;
stale digests require rereading and reconsideration. Report ticket-write failures.
Load [Other repositories](issue-tracker/other-repositories.md) for cross-project
parts/Dependencies, [Publication](issue-tracker/publication.md) only for publication
questions. Atomic `amend-group` remains unavailable; preserve unsupported changes
as proposals and holds, never claim they applied.
