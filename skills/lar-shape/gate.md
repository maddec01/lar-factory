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
   which work each waits on (`lar-work waiting-on`). This shaping thread is
   done. Ready is a refinement result. Starting a build is the user's later
   choice, with no publication or permission prompt at this gate.
