# 4. Gate


1. A **Doubt subagent** gets only the path of
   [`agents/doubt.md`](agents/doubt.md), the brief and the repo path, no
   conversation. Fix what it finds, saving the brief again.
2. In one batch, ask the user every assumption they haven't confirmed and every
   Doubt finding you can't fix.
3. Read `lar-work gate <work ID>` after the final brief edit, then record the
   passing gate with `lar-work record-gate <work ID> --revision N --digest <briefDigest> --identity <approver> --evidence "<Doubt result and confirmed assumptions>"`.
   Use the current work revision and exact brief digest. A changed brief loses
   its prior gate evidence and must pass again. Recording evidence changes no
   Status and publishes nothing.
4. Set **Ready** on each build: this record if it's a build, and each build
   record made while shaping. Tell the user in chat which builds are Ready and
   which work each waits on (`lar-work waiting-on`). Once refinement finishes,
   offer [publication](shared/issue-tracker/publication.md), checking concept
   readiness when this build belongs to one. Publication is optional and
   separate from Ready. This shaping thread is done; the user starts each
   build from the board (**5. Start the build**).

