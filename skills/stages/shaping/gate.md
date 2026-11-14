# 4. Gate

Input: saved brief, confirmed scope and affected work. Output: current Doubt
and board approval, or its generated board wait.

1. Run `lar-work gate <work ID>`. Resolve held edits in `specSync`; report read
   failures and warnings. Review its refreshed `display.brief` against code.
2. Read the [domain-doc setting](shared/domain-docs-setting.md) for Doubt.
   For grouped or overlapping work, follow [Reconcile group](shared/reconcile-group.md).
   Run `lar-work build-overlap <work ID>`. Review declared Files/Contracts and
   semantic conflicts, including other concepts and standalone work. Record
   ordering in brief/map declarations and run `sync-blockers` on the parent or
   standalone ID, or save reasons as
   `[ {"otherWorkId":"ID","reason":"why no ordering is needed"} ]`.
   Run `lar-work doubt-package <work ID>` after those edits. A **Doubt subagent**
   gets that exact package, repository paths, resolved domain-doc setting/paths,
   [Doubt](doubt.md) and the orchestration guide's **Wait for delegated work**, no conversation.
   Fix findings within the destination; ask for scope changes. Every amendment
   ends here: rerun Doubt after edits before ending the turn.
   Record its clean result with `lar-work record-doubt <work ID> --digest <packageDigest> --identity <Doubt identity> --evidence "<result and code evidence>" [--file <ordering reasons.json>]`.
3. Ask unresolved assumptions and findings through [Questions](shared/questions.md).
4. After the final edit, require `lar-work brief-scope-check <work ID>` to pass, then run `lar-work gate <work ID>` again. Save its `display`
   object as `display.json`. Show its complete `brief` and `approvalDigest`
   verbatim; ask Pedro to use Approve brief in the board, then stop.
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
   affected briefs and save the map. Rerun Doubt and approval for changed packages.
5. Keep active builds in Build; set only unstarted gated builds **Ready**. Report `lar-work waiting-on` for each. Eligible
   approved briefs queue as Specs under saved settings; report pending failures.
   Starting later follows [Start build](start-build.md); a gate alone launches nothing.

After group scope changes or board approval (single/batch), resume
[Reconcile group](shared/reconcile-group.md).
