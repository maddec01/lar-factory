# Retro

Input: the build's first handback, with required checks green and the delivery
PR not merged. Output: suggestions saved for the desk. [CI](ci.md) runs this
stage in its handback turn only when `Frozen retro: on`, and sets the Status
afterwards.

Follow [Review session](../review-session.md). Route suggestions per
[Retro capture](../shared/retro-capture.md), then save all with
`lar-work propose-retro <work ID> --revision N --file F`, which creates the
Retro record. Save `[]` if none. Return to CI: the board's **Choose follow-ups**
card collects the selection before merge and creates chosen List
records/tickets. Never ask for picks in chat or create them.
