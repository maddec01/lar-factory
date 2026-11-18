# 4. Gate

Input: saved brief, confirmed scope and affected work. Output: current Doubt
and board approval, or its generated board wait.

For a scope correction explicitly requested during delivery PR review, use
lar-build's `stages/recovery.md#human-pr-scope-amendments`. Its
`approve-pr-amendment` command rereads the human's request and write permission
(or the saved legacy Verify failure), then binds it to the fresh corrected gate.
The producer's authorization covers consistent corrections to affected linked
briefs, parent map and Outcome, without a consumer PR. Begin the whole amendment
before edits and commit its exact content and gate receipts as one batch; do not
ask for propagation confirmation or fall back to Approve briefs. That exact
correction needs no repeated human question. All ordinary initial
gates, Reshape and unresolved choices still follow the board approval below.

1. Run `lar-work gate <work ID>`. Resolve held edits in `specSync`; report read
   failures and warnings. Review its refreshed `display.brief` against code.
2. Read the [domain-doc setting](shared/domain-docs-setting.md) for Doubt.
   For grouped work, follow [Reconcile group](shared/reconcile-group.md).
   Review declared Contracts and semantic conflicts with other concepts and
   standalone work. Record blockers in brief/map declarations and run
   `sync-blockers` on the parent or standalone ID.
   Run `lar-work doubt-package <work ID>` after those edits and keep its output
   in this thread. A **Doubt subagent** gets that exact package, repository
   paths, resolved domain-doc setting/paths, [Doubt](doubt.md) and the
   orchestration guide's **Wait for delegated work**, no conversation. After a
   round with findings, add those findings and the brief's `diff -u` since that
   package, but only when the package changed solely through edits and answers
   for them; anything else (first round, related merge, other scope change,
   findings not in this thread) gets a full review.
   Grouped review follows the guide's **Run contract**: launch and finish on the
   shaping run owner; keep each work ID's package, findings and diff distinct,
   choose recheck or full review per work ID, and record a clean result for each
   on its own work ID below.
3. Make every `Fix:` edit yourself. Ask the round's `Decision:` findings, and
   only those, as one batch through [Questions](shared/questions.md); a scope
   change is a decision. Every amendment ends here: rerun Doubt before ending the
   turn unless waiting for answers. Rounds have no limit. Record the clean result
   for the exact final package with `lar-work record-doubt <work ID> --digest <packageDigest> --identity <Doubt identity> --evidence "<result and code evidence>"`.
   A shaping [handoff](shared/handoff.md) copies open findings and the last
   reviewed package verbatim.
4. After the final edit, require `lar-work brief-scope-check <work ID>` to pass, then run `lar-work gate <work ID>` again.
   When only a producer contract changed, fresh clean Doubt can retain the consumer's approval
   if its own approved inputs are unchanged. If `gate.current` is true, continue without asking again.
   Changed consumer content needs board approval; the request shows the changed passage.
   Otherwise save its `display`
   object as `display.json`. Show its complete `brief` and `approvalDigest`
   verbatim. Explain approval's Auto-build behavior as below; ask the user to use
   Approve brief in the board, then stop.
   The gate generates its wait; never save a Needs you duplicate. Feedback
   returns to Shaping and Doubt. Reshape always requires renewed approval. Keep approval in gate evidence, never Confirmed.
   For grouped work, inspect `lar-work gate-batch --file ids.json`: complete briefs,
   source revisions, approval/batch digests and current immutable Doubt results.
   Only the user's **Approve brief** action in the board records approval. For a group,
   **Approve briefs** holds only parts needing approval and approves that batch atomically; any
   stale text, revision or Doubt result rejects the whole batch. Agent
   `record-gate` and `record-gate-batch` calls refuse: ask the user to approve
   in the board, then stop. A Verify note,
   an approver name or agent-written response reference never grants approval.
   If this gate supersedes an answer, run `lar-work supersede-answer` per
   [Completion](shared/issue-tracker/completion.md), reconcile
   affected briefs and save the map. Rerun Doubt for changed packages and approval for changed approved content.
5. Keep active builds in Build; set only unstarted gated builds **Ready**. Report `lar-work waiting-on` for each. Eligible
   approved briefs queue as Specs under saved settings; report pending failures.
   In the handback, say what approval will do using the runtime block's saved
   Auto-build setting: **on** means the board automatically starts eligible
   approved builds as capacity and blockers allow (and after group refinement);
   **off** means they wait for a board start unless their group is already
   authorized to run. If the setting is absent or may have changed, direct
   the user to the board's displayed Auto-build setting rather than
   guessing. Apply this to single and grouped approval and resumed Ready work.
   Never say approval requires a separate Build action when Auto-build is on.
   The board owns every launch per [Start build](start-build.md).

After group scope changes or board approval (single/batch), resume
[Reconcile group](shared/reconcile-group.md).
