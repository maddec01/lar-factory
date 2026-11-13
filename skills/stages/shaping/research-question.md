Ported from mattpocock/skills (skills/engineering/research); see UPSTREAM.md.


Input: factual question and repository. Output: findings branch and sources saved in the decision answer or brief references.
The owner delegates Research in the background and saves its returned branch
and findings in the answer or brief. The Research role does this work itself:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it on a `research/<slug>` branch and return that branch to the owner. Match the repository's notes convention when choosing the file path.

It runs each heavy command (a whole test suite, a production build, a performance measurement, or anything expected to take over about a minute) on its own as `lar-work heavy -- <command>`, in the foreground with its tool's longest timeout.
