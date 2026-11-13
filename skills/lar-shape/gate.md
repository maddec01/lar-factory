# 4. Gate

1. Run `lar-work gate <work ID>` to reread an existing ticket Spec. Inspect
   `specSync` for read errors, warnings and held GitHub edits. Report a failed
   read and that the last local copy is in use. Resolve held edits in item
   details before gating. Then reread the brief and record revision. Review
   this refreshed text, per [Ticket Specs](shared/issue-tracker/work-records.md#ticket-specs).
2. A **Doubt subagent** gets the shared orchestration guide with the instruction
   to apply **Wait for delegated work**, the path of
   [`agents/doubt.md`](agents/doubt.md), the brief and the repo path, no
   conversation. Fix what it finds, saving the brief again.
3. In one batch, ask the user every assumption they haven't confirmed and every
   Doubt finding you can't fix.
4. Read `lar-work gate <work ID>` after the final brief edit, then reread the
   brief and revision. If the refresh changed the reviewed text, review it
   again. Show the complete final brief and ask through
   [Questions](shared/questions.md) whether it meets the user's expectations
   and may be marked Ready. This checkpoint is required even with no remaining
   assumptions or Doubt findings. Wait in Needs you for explicit approval of
   this exact text. Silence is not approval. Feedback returns the item to
   Shaping: revise, review and present the complete result again.

   Retain the approved `briefDigest` and the explicit response for gate evidence.
   Store this final approval only in gate evidence, never in the brief's
   Confirmed section, as the question guide's exception requires. On resume,
   reuse explicit approval of the unchanged digest from the thread or existing
   gate evidence. A passing gate without that confirmation is insufficient.
   Reshape requires a new final confirmation even when the text is unchanged.

   After approval, refresh with `lar-work gate <work ID>` and reread the brief
   and revision. A changed digest requires review and renewed confirmation.
   Only for the unchanged approved digest, record the passing gate with
   `lar-work record-gate <work ID> --revision N --digest <approved briefDigest> --identity <approver> --evidence "<explicit user approval of this digest, response reference, Doubt result and confirmed assumptions>"`.
   The command rereads the ticket again; changed text requires review and renewed confirmation. Eligible tickets queue the whole brief as Spec under the saved
   setting. Gate evidence itself changes no Status. A failed write stays pending
   and does not block Ready; report its error and the retry in item details.
   If this gate replaces a decision answer, run `lar-work supersede-answer` per
   [Completion](shared/issue-tracker/work-records.md#completion), then reconcile
   affected briefs and save the map before Ready.
5. Set **Ready** on each build: this record if it's a build, and each build
   record made while shaping. Tell the user which builds are Ready and which
   work each waits on (`lar-work waiting-on`). This shaping thread is done.
   A Ready build waits for the user's Start build on the board. The exception is
   Auto-build. With this machine's Auto-build switch on, the board starts
   eligible Ready builds by itself, up to the build limit. Auto-build starts a
   build under a concept only once the concept's Refinement is complete.
   The saved Spec setting needs no separate publication or permission prompt
   at this gate.
