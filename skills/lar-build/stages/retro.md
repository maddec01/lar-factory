# Retro

Input: the completed build and reviews as soon as its delivery PR opens.
Output: suggestions saved for the desk. [CI](ci.md) runs this stage before
reading or waiting for checks, only when `Frozen retro: on` and no Retro record
exists. It does not depend on CI or handback. Finish saving even if the PR merges
while you work; never hold delivery or Done for suggestions or picks.

Read the current brief with `lar-work body <work ID> --body brief`, the source
ticket including its **Original** text, and the recorded findings with
`lar-work review-rounds <work ID>`. Follow
[Review session](../review-session.md), checking **Excluded**, deferred findings
and the PR's out-of-scope notes before deciding there are no follow-ups.
Scope deferred in the Spec or ticket ("for now", "later", "only X", "not yet")
becomes a suggestion by default, including **Excluded** items those words refer
to. Excluded from this delivery does not mean rejected forever. Omit deferred
work only when already delivered or tracked, or explicitly a permanent non-goal;
cite that evidence in the handback. There is no suggestion quota.
Route suggestions per
[Retro capture](../shared/retro-capture.md), then save all with
`lar-work propose-retro <work ID> --revision N --file F`, which creates the
Retro record. Save `[]` if none. Return to CI: the board's **Choose follow-ups**
card collects the optional selection independently of delivery, including after Done, and creates chosen
List records/tickets. It stays until Pedro chooses or dismisses it. Never ask
for picks in chat or create them.

Retro is optional follow-up capture, never a delivery gate. Return to CI without
waiting for selection, shaping or implementation, even when suggestions exist.
If saving fails, reread and retry once for a revision conflict; otherwise report
the failure and continue delivery. Never set **Needs you** for Retro.
