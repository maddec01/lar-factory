Ported from mattpocock/skills (skills/productivity/grilling); see UPSTREAM.md.

# Grilling with docs

Input: unresolved choices, prior answers and approved destination. Output:
accepted answers and enabled domain drafts; unresolved choices remain holds.

Read [Domain modeling](shared/domain-docs.md) to challenge terms against the
existing glossary/ADRs and draft each settled term or qualifying decision in
records when enabled. With docs OFF, read existing language and write "none".

Map the design's dependent product decisions. Each round asks the whole frontier whose
prerequisites are settled, using [Questions](shared/questions.md): number each
question, recommend an answer and word it so "yes" accepts that recommendation.
Wait for answers, then recompute the frontier. Dependent unanswered questions
belong to a later round. Reuse prior answers without asking again.

Facts are the agent's job. Delegate exploration/research for facts available
from code, tools or sources; continue independent questions while it runs.
A running exploration is an unsettled prerequisite. Only unresolved user-visible
product behaviour goes to the user. Settle engineering edge cases (storage
failures, error handling) with the simplest safe default, preserving the requested
behaviour without unrequested notices or warnings; write those defaults in the
brief rather than turning them into questions. Finish only when every branch is
settled and defaults are explicit. Save product answers in Confirmed, the decision
answer or map before Brief.
