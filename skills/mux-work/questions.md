# Question UI

Ask Pedro ordinary questions with the question UI (`AskUserQuestion`), so T3
shows the thread as waiting: Size up, grilling rounds, the prototype pick,
Gate assumptions, Doubt findings, the launch check, Concepts,
`decision: grill`, and the builder's stops. Retro picks and their
clarifications use [chat](#retro-picks).
If the tool is deferred, load it with `ToolSearch`; if it isn't available, ask
in the `grilling` chat format.

Every ordinary question batch runs these once, however many calls it takes:

1. Set **Needs you**, then make the calls; each blocks.
2. After the last call, comment the answers on the issue in one comment
   (summarised; never secrets, tokens or private hostnames).
3. Set the status back to the step's: Shaping while shaping, In progress or
   Review in a build.

Map the `grilling` format onto the call instead of repeating it in chat:

- question: `Qn - <title>: <body>`, worded so "yes" accepts the
  recommendation;
- first option: the recommended answer, its label ending `(Recommended)`, the
  reasoning in its description. The others are the real alternatives; "Other"
  stays for free text. Without an honest recommendation (a prototype pick),
  mark nothing `(Recommended)`;
- at least 2 options. A confirmation like Size up gets "Confirm" and
  "Correct it"; if he picks "Correct it" without text, ask what to correct in
  a follow-up call of the same batch;
- `header` ≤12 characters; option labels 1–5 words plus `(Recommended)`;
- ≤4 questions per call. Split a longer batch (a grilling round, Gate
  assumptions, Doubt findings) into consecutive calls, numbering on, so a round
  still asks the whole frontier.

## Retro picks

Show every suggestion together as one complete numbered list in chat, with
its name and full description, even for more than four suggestions or long
descriptions. Keep selection and any clarification entirely in chat; question
UI option limits must neither split nor truncate the list.

Ask Pedro to reply with numbers, names, free-text descriptions, “all” or
“none”, then wait for his reply using normal chat waiting. Add no notification
feature. With no suggestions, skip the selection question.

Follow [Retro capture](retro-capture.md#select-and-route) to resolve the reply
and capture explicit picks. It is the answers record for this chat exchange;
skip steps 1–3 above and preserve the source issue's final status throughout
selection, clarification, capture, retries and failure reporting.
