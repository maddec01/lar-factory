Ported from mattpocock/skills (skills/productivity/grilling); see UPSTREAM.md.

# Grilling with docs

Input: unresolved choices, prior answers and approved destination. Output:
accepted answers and enabled domain drafts; unresolved choices remain holds.

Read [Domain modeling](shared/domain-docs.md) to challenge terms against the
existing glossary/ADRs and draft each settled term or qualifying decision in
records when enabled. With docs OFF, read existing language and write "none".

Map the design's dependent decisions. Each round asks the whole frontier whose
prerequisites are settled, using [Questions](shared/questions.md): number each
question, recommend an answer and word it so "yes" accepts that recommendation.
Wait for answers, then recompute the frontier. Dependent unanswered questions
belong to a later round. Reuse prior answers without asking again.

Facts are the agent's job. Delegate exploration/research for facts available
from code, tools or sources; continue independent questions while it runs.
A running exploration is an unsettled prerequisite. Product decisions go to
the user. Finish only when every branch is settled and nothing remains silently
assumed. Save answers in Confirmed, the decision answer or map before Brief.
