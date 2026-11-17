# 4. Gate

Input: saved brief, confirmed scope and affected work. Output: current Doubt
and board approval, or its generated board wait.

1. Run `lar-work gate <work ID>`. Resolve held edits in `specSync`; report read
   failures and warnings. Review its refreshed `display.brief` against code.
2. Read the [domain-doc setting](shared/domain-docs-setting.md) for Doubt.
   For grouped work, follow [Reconcile group](shared/reconcile-group.md).
   Review declared Contracts and semantic conflicts with other concepts and
   standalone work. Record blockers in brief/map declarations and run
   `sync-blockers` on the parent or standalone ID.
   Run `lar-work doubt-package <work ID>` after those edits. A **Doubt subagent**
   gets that exact package, repository paths, resolved domain-doc setting/paths,
   [Doubt](doubt.md) and the orchestration guide's **Wait for delegated work**, no conversation.
   Fix findings within the destination; ask for scope changes. Every amendment
   ends here: rerun Doubt after edits before ending the turn.
   Record its clean result with `lar-work record-doubt <work ID> --digest <packageDigest> --identity <Doubt identity> --evidence "<result and code evidence>"`.
3. Ask unresolved assumptions and findings through [Questions](shared/questions.md).
4. After the final edit, require `lar-work brief-scope-check <work ID>` to pass, then run `lar-work gate <work ID>` again.
   When only a producer contract changed, fresh clean Doubt can retain the consumer's approval
   if its own approved inputs are unchanged. If `gate.current` is true, continue without asking again.
   Changed consumer content needs board approval; the request shows the changed passage.
   Otherwise save its `display`
   object as `display.json`. Show its complete `brief` and `approvalDigest`
   verbatim. Explain approval's Auto-build behavior as below; ask Pedro to use
   Approve brief in the board, then stop.
   The gate generates its wait; never save a Needs you duplicate. Feedback
   returns to Shaping and Doubt. Reshape always requires renewed approval. Keep approval in gate evidence, never Confirmed.
   For grouped work, inspect `lar-work gate-batch --file ids.json`: complete briefs,
   source revisions, approval/batch digests and current immutable Doubt results.
   Only Pedro's **Approve brief** action in the board records approval. For a group,
   **Approve briefs** holds only parts needing approval and approves that batch atomically; any
   stale text, revision or Doubt result rejects the whole batch. Agent
   `record-gate` and `record-gate-batch` calls refuse: ask Pedro to approve
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
   Pedro to the board's displayed Auto-build setting rather than
   guessing. Apply this to single and grouped approval and resumed Ready work.
   Never say approval requires a separate Build action when Auto-build is on.
   The board owns every launch per [Start build](start-build.md).

After group scope changes or board approval (single/batch), resume
[Reconcile group](shared/reconcile-group.md).
