# 4. Gate

1. Run `lar-work gate <work ID>`. Resolve held edits in `specSync`; report read
   failures and warnings. Review its refreshed `display.brief` against code.
2. A **Doubt subagent** gets the orchestration guide's **Wait for delegated
   work**, [`agents/doubt.md`](agents/doubt.md), the exact brief and repo path,
   no conversation. Fix findings and rerun Doubt after edits.
3. Ask unresolved assumptions and findings through [Questions](shared/questions.md).
4. After the final edit, run `lar-work gate <work ID>` again. Save its `display`
   object as `display.json`. Show its complete `brief` and `approvalDigest`
   verbatim; ask whether this exact brief may be Ready. Wait in Needs you for
   explicit approval via Questions, including its wait/resume commands. Feedback
   returns to Shaping and Doubt. Reshape always requires renewed approval. Keep approval in gate evidence, never Confirmed.
   Record with `lar-work record-gate <work ID> --file display.json --digest <approved approvalDigest> --identity <approver> --evidence "<response reference, Doubt result and confirmed assumptions>"`.
   The command refreshes the ticket and checks displayed text, source revision
   and approval digest together. A mismatch requires renewed review and approval.
   If this gate replaces an answer, run `lar-work supersede-answer`, reconcile
   affected briefs and save the map before Ready. Re-gate changed work.
5. Set **Ready** on gated builds. Report `lar-work waiting-on` for each. Eligible
   approved briefs queue as Specs under saved settings; report pending failures.
   Builds wait for Start build, or enabled Auto-build after concept refinement.
