# Question UI

Ask Pedro every question with the question UI (`AskUserQuestion`), so T3 shows
the thread as waiting: Size up, grilling rounds, the prototype pick, Gate
assumptions, Doubt findings, Concepts, `decision: grill`, and the builder's
stops and retro picks. If the tool is deferred, load it with `ToolSearch`; if
it isn't available, ask in the `grilling` chat format.

Retro picks and their clarifications keep the source issue's final status
throughout questions, capture, retries and failure reporting;
[Retro capture](retro-capture.md) is their answers record, so they skip steps
1–3. Every other batch runs these once, however many calls it takes:

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
  still asks the whole frontier;
- retro picks: `multiSelect` questions whose options are the suggestions, none
  `(Recommended)`, ≤4 each, spread so each has at least 2; add "None" when one
  is left alone. No suggestions, no question.
