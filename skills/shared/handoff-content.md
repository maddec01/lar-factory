Ported from mattpocock/skills (skills/productivity/handoff/SKILL.md); see UPSTREAM.md.

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Name the work ID, and put the document in the continuation thread's message. Follow handoff.md for the continuation thread and the build review state to include.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, work records, commits, diffs). Reference them by path, URL or work ID instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
