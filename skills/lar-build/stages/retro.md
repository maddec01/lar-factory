# Retro

Input: the completed build and reviews as soon as its delivery PR opens.
Output: suggestions saved for the desk. [CI](ci.md) runs this stage before
reading or waiting for checks, only when `Frozen retro: on` and no Retro record
exists. It does not depend on CI or handback. Finish saving even if the PR merges
while you work; never hold delivery or Done for suggestions or picks.

Follow [Review session](../review-session.md). Route suggestions per
[Retro capture](../shared/retro-capture.md), then save all with
`lar-work propose-retro <work ID> --revision N --file F`, which creates the
Retro record. Save `[]` if none. Return to CI: the board's **Choose follow-ups**
card collects the optional selection independently of delivery and creates
chosen List records/tickets, including after Done. Never ask for picks in chat or create them.
