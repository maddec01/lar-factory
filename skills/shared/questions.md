# Question UI

Ask the user ordinary questions with the question UI (`AskUserQuestion`), so T3
shows the thread as waiting for an unresolved decision: grilling rounds, the prototype pick,
Gate assumptions, Doubt findings, Concepts,
grill decisions, and the builder's stops. Retro picks and their
clarifications use [chat](#retro-picks).
If the tool is deferred, load it with `ToolSearch`; if it isn't available, ask
in chat with each numbered question, its title and body, followed by the
recommended answer. Separate questions with a horizontal rule. Word each so
"yes" accepts the recommendation.

Reuse answers and authorization already given. State routine shaping routes and
implementation choices, then continue. Ask only for a missing decision, genuine
conflict or expansion of scope. The saved sync choice needs no per-update prompt.

Keep questions short. Use the issue title or ticket number only when context is
needed. Local work IDs belong in commands and tool identifiers, never in the
question text shown to the user.

Every ordinary question batch runs these once, however many calls it takes:

1. Set **Needs you**, then make the calls; each blocks.
2. After the last call, keep the answers for the record: a decision's answer
   body, or the brief's or map's **Confirmed** when you write them. Include
   Domain docs drafts only when that setting is ON; otherwise write "none".
   A whole gated brief reaches its ticket through the saved Spec setting, rather
   than separate question-and-answer comments.
3. Set the status back to the step's: Shaping while shaping, In progress or
   Review in a build.

Use this format for the call:

- question: `Qn - <title>: <body>`, worded so "yes" accepts the
  recommendation;
- first option: the recommended answer, its label ending `(Recommended)`, the
  reasoning in its description. The others are the real alternatives; "Other"
  stays for free text. Without an honest recommendation (a prototype pick),
  mark nothing `(Recommended)`;
- at least 2 options representing real alternatives. Ask a follow-up only when
  the selected answer leaves a necessary decision unresolved;
- `header` ≤12 characters; option labels 1–5 words plus `(Recommended)`;
- ≤4 questions per call. Split a longer batch (a grilling round, Gate
  assumptions, Doubt findings) into consecutive calls, numbering on, so a round
  still asks the whole frontier.

## Retro picks

Show every suggestion together as one complete numbered list in chat, with
its name and full description, even for more than four suggestions or long
descriptions. Keep selection and any clarification entirely in chat; question
UI option limits must neither split nor truncate the list.

Ask the user to reply with numbers, names, free-text descriptions, “all” or
“none”, then wait for their reply using normal chat waiting. Add no notification
feature. With no suggestions, skip the selection question.

Follow [Retro capture](retro-capture.md#select-and-route) to resolve the reply
and capture explicit picks. It is the answers record for this chat exchange;
skip steps 1–3 above and keep the source build's final Status throughout
selection, clarification, capture, retries and failure reporting.
