# Question UI

Every question to Pedro goes through the question UI (`AskUserQuestion`), so
T3 shows the thread as waiting: Size up, grilling rounds, the prototype pick,
Gate assumptions, Doubt findings, Concepts, `decision: grill`, and the
builder's stops and retro picks. If the tool is deferred, load it with
`ToolSearch`; if it isn't available, ask in the `grilling` chat format.
For retro picks and their clarifications, preserve the source issue's final
status throughout questions, capture, retries and failure reporting. Use
[Retro capture](retro-capture.md) as the answers record; skip steps 1–3 below.
For other questions, run these steps once per batch, however many calls it takes:
1. Set **Needs you**, then make the question UI calls; each blocks.
2. After the last call, comment the answers on the issue in one comment
   (summarise; never copy secrets, tokens or private hostnames).
3. Set the status back to the one the step was in: Shaping while shaping,
   In progress or Review in a build.

Map the `grilling` format onto the call, and don't repeat it in chat:
- question: `Qn - <title>: <body>`, worded so "yes" accepts the
  recommendation;
- first option: the recommended answer, its label ending `(Recommended)`,
  the reasoning in its description. The other options are the real
  alternatives; "Other" stays for free text. Mark nothing `(Recommended)`
  when there's no honest recommendation (a prototype pick);
- at least 2 options. A confirmation like Size up gets "Confirm" and
  "Correct it". If he picks "Correct it" without text, ask what to correct
  in a follow-up call of the same batch;
- `header` at most 12 characters, option labels 1–5 words plus
  `(Recommended)`;
- at most 4 questions per call. Split a longer batch (a grilling round, Gate
  assumptions, Doubt findings) into consecutive calls and keep the numbering
  going, so a round still asks the whole frontier;
- retro picks: `multiSelect` questions whose options are the suggestions,
  none `(Recommended)`, at most 4 each, spread so each has at least 2; add
  "None" when one is left alone. No suggestions, no question.
