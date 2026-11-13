# Question UI

Input: unresolved choice, prior answers and resume Status. Output: saved answer
or explicit wait. Final brief approval is stored only in digest-bound gate evidence.

Use the available question UI for ordinary decisions, including understanding,
prototype picks, grilling, gate findings and build holds. Discover deferred
question tools when needed. If unavailable, save the numbered question and
Needs you notice, and ask in chat: title, body, recommended answer, separated
from other questions by a horizontal rule. Word recommendations so "yes"
accepts them. Brief approval uses [Gate](../gate.md); chat or T3 answers
cannot record approval.

Reuse prior answers and authorization. Continue routine routes and implementation
choices. Ask only for missing decisions, real conflicts or expanded scope,
except Size up and Gate always need their specified explicit confirmations.
Keep questions short; use title/ticket for context, never local work IDs.

For each ordinary batch, however many calls it takes:
1. Save the question reference and resume Status; run `lar-work set-needs-you ID
   --revision N --reason "<question>"` before asking. Wait for every answer,
   including asynchronous replies. Silence is not approval.
2. Save answers in the decision's answer or the brief/map's Confirmed section.
   Draft domain docs only when ON, otherwise "none". Keep final approval only in
   board-recorded gate evidence; never append it to Confirmed.
3. Run `lar-work clear-needs-you ID --revision N --status "<resume Status>"`
   to clear the reason and restore Shaping, In progress or Review together.

Format calls as `Qn - <title>: <body>`. Put the recommended option first, with
`(Recommended)` in its label and reasons in its description. With no honest
recommendation, such as a prototype choice, mark none. Supply at least two real
alternatives, leaving free text available. Keep headers within 12 characters
and labels to 1–5 words plus the recommendation suffix. Respect the tool's
question limit, at most four per call; continue numbering across calls to cover
the whole frontier. Follow up only for a necessary unresolved decision.

