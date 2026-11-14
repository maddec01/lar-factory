# Reconcile affected work

Input: changed/overlapping work. Output: coherent product contracts and records.

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
affected briefs needing approval. Stop for Pedro's board approval, without a generic Needs you duplicate;
then resume reconciliation.

Use `sync-blockers` for declarations. For stale current-answer/map sources, use
`refresh-projections GROUP_ID --file F`: `{revisions:{ID:N},answers:{ID:text},map?}`
with all group revisions. Answers use `## Product` for choices; `## History` is excluded from approvals.
Status comes from records, never answers/map. Group delivery comes from parts;
never set a group parent Ready. Commands reject stale brief quotes.

Before ending shaping, settle factory details yourself. Remove resolved Fog; record `set-fog --fog gone` when
empty. Every remaining bullet starts `[decision: ID]` for an open decision,
`[factory: ID]` for a task decision actively in Shaping, or `[question: ID]`
for Pedro's actually pending question with saved Needs you (visible on Your
desk; answer in T3). IDs name this group or its direct parts. Queued factory
work uses a decision route. Finished, retired, missing or unrouted Fog is a
mechanical hold; repair it, never leave an ownerless wait.

Save release order with `set-release-plan`: `shipsWith` names delivery work IDs;
`who` is `Pedro` for human steps, `Agent` for automated ones. Record Agent evidence
with `complete-release-step`, then end the turn. The board dispatches Outcome
after release settles; measure once in that turn with its `--input-digest`.
For Pedro's approval, save the step/wait and end the turn; never open a T3 question.
Save the map after current answers and domain drafts.

Resolve reviewed source changes with `lar-work resolve-reconcile GROUP_ID --item
KEY --digest H --evidence "what was checked/fixed"`. Repair mechanical holds;
stale digests require rereading and reconsideration. Report ticket-write failures.
Load [Other repositories](issue-tracker/other-repositories.md) for cross-project
parts/Dependencies, [Publication](issue-tracker/publication.md) only for publication
questions. Atomic `amend-group` remains unavailable; preserve unsupported changes
as proposals and holds, never claim they applied.
