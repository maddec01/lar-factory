# 4. Gate

1. Run `lar-work gate <work ID>`. Resolve held edits in `specSync`; report read
   failures and warnings. Review its refreshed `display.brief` against code.
2. Run `lar-work build-overlap <work ID>`. Review declared Files/Contracts and
   semantic conflicts, including other concepts and standalone work. Record
   ordering with `lar-work add-blocker`, or save reasons as
   `[ {"otherWorkId":"ID","reason":"why no ordering is needed"} ]`.
   Run `lar-work doubt-package <work ID>` after those edits. A **Doubt subagent**
   gets that exact package, repository paths, [`agents/doubt.md`](agents/doubt.md)
   and the orchestration guide's **Wait for delegated work**, no conversation.
   Fix findings within the approved destination; ask for new scope, decisions
   or changes to active builds. Rerun Doubt after brief or affected-work edits.
   Record its clean result with `lar-work record-doubt <work ID> --digest <packageDigest> --identity <Doubt identity> --evidence "<result and code evidence>" [--file <ordering reasons.json>]`.
3. Ask unresolved assumptions and findings through [Questions](shared/questions.md).
4. After the final edit, run `lar-work gate <work ID>` again. Save its `display`
   object as `display.json`. Show its complete `brief` and `approvalDigest`
   verbatim; ask whether this exact brief may be Ready. Wait in Needs you for
   explicit approval via Questions, including its wait/resume commands. Feedback
   returns to Shaping and Doubt. Reshape always requires renewed approval. Keep approval in gate evidence, never Confirmed.
   Record with `lar-work record-gate <work ID> --file display.json --digest <approved approvalDigest> --identity <approver> --evidence "<response reference, Doubt result and confirmed assumptions>"`.
   The command refreshes the ticket and checks displayed text, source revision
   and approval digest together. A mismatch requires renewed review and approval.
   For several builds, save a JSON array of IDs and run
   `lar-work gate-batch --file ids.json > manifest.json`. Display every complete
   brief, its digests, source revision and Doubt result/identity, plus the manifest
   `digest`. One explicit yes approves that manifest. Record it atomically with
   `lar-work record-gate-batch --file manifest.json --digest <approved manifest digest> --identity <approver> --evidence "<response reference>"`.
   Any stale member rejects all; renew review and approval for a fresh manifest.
   If this gate supersedes an answer, run `lar-work supersede-answer`, reconcile
   affected briefs and save the map. Rerun Doubt and approval for changed packages.
5. Set **Ready** on gated builds. Report `lar-work waiting-on` for each. Eligible
   approved briefs queue as Specs under saved settings; report pending failures.
   Builds wait for Start build, or enabled Auto-build after concept refinement.
