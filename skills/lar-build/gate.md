# 4. Gate

1. Run `lar-work gate <work ID>` to reread an existing ticket Spec. Inspect
   `specSync` for read errors, warnings and held GitHub edits. Report a failed
   read and that the last local copy is in use. Resolve held edits in item
   details before gating. Then reread the brief and record revision. Review
   this refreshed text, per [Ticket Specs](shared/issue-tracker/work-records.md#ticket-specs).
2. A **Doubt subagent** gets only the path of
   [`agents/doubt.md`](agents/doubt.md), the brief and the repo path, no
   conversation. Fix what it finds, saving the brief again.
3. In one batch, ask the user every assumption they haven't confirmed and every
   Doubt finding you can't fix.
4. Read `lar-work gate <work ID>` after the final brief edit, then reread the
   brief and revision. If the refresh changed the reviewed text, review it
   again. Record the passing gate with
   `lar-work record-gate <work ID> --revision N --digest <briefDigest> --identity <approver> --evidence "<Doubt result and confirmed assumptions>"`.
   Use the current revision and exact digest. The command rereads the ticket
   again, so a stale revision or digest requires another read and review.
   Eligible tickets queue the whole brief as Spec under the saved setting.
   Gate evidence itself changes no Status. A failed write stays pending and
   does not block Ready; report its error and the retry in item details.
5. Set **Ready** on each build: this record if it's a build, and each build
   record made while shaping. Tell the user which builds are Ready and which
   work each waits on (`lar-work waiting-on`). This shaping thread is done.
   Ready commits the user to no implementation. The saved Spec setting needs
   no separate publication or permission prompt at this gate.
