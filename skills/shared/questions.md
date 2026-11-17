# Question UI

Input: unresolved choice, prior answers and resume Status. Output: saved answer
or explicit wait. Final brief approval is stored only in digest-bound gate evidence.

Use the available question UI for ordinary decisions, including unresolved understanding,
prototype picks, grilling, gate findings and build holds. Discover deferred
question tools when needed. If unavailable, save the numbered question and
Needs you notice, and ask in chat: title, body, recommended answer, separated
from other questions by a horizontal rule. Word recommendations so "yes"
accepts them. Gates, Verify, release steps, Outcome and merges use board controls.
End the turn; never duplicate them with Needs you or a T3 question. Brief approval uses [Gate](../gate.md).

Reuse prior answers and authorization. Continue routine routes and implementation
choices. Ask only for missing decisions, real conflicts or expanded scope.
When a request names each repository's role in one outcome, Size up chooses
linked work itself and asks only unresolved product questions. Still ask when
the request leaves other repositories' involvement open. Reuse the submitted
request as scope source when no decision is open and the work follows that
request; deriving linked structure from its named roles needs no confirmation.
Do not ask for a scope confirmation that contains no choice. Gate remains the
one explicit approval of the final brief.
Keep questions short; use title/ticket for context, never local work IDs.

For each ordinary batch, however many calls it takes:
1. Save the question reference, then open the question UI. T3's pending request
   puts the question on Your desk and removes it when answered. Do not also run
   `set-needs-you` or change Status for a question asked through that UI: doing
   so invents a wait before the question and leaves a second wait after its answer.
   Wait for every answer, including asynchronous replies. Silence is not approval.
2. Save the substance of product decisions in the decision's answer or the
   brief/map's Confirmed section, omitting Confirmed when empty. Keep question
   references, button labels and confirmation recitals in local records.
   Draft domain docs only when ON, otherwise "none". Keep final approval only in
   board-recorded gate evidence; never append it to Confirmed.
3. Continue in the existing Status. Only a chat fallback without a question UI
   saves a Needs you notice; clear that fallback with `lar-work clear-needs-you ID
   --revision N --status "<resume Status>"` after its answer.

Format calls as `Qn - <title>: <body>`. Put the recommended option first, with
`(Recommended)` in its label and reasons in its description. With no honest
recommendation, such as a prototype choice, mark none. Supply at least two real
alternatives, leaving free text available. Keep headers within 12 characters
and labels to 1–5 words plus the recommendation suffix. Respect the tool's
question limit, at most four per call; continue numbering across calls to cover
the whole frontier. Follow up only for a necessary unresolved decision.

