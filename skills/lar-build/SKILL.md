---
name: lar-build
description: Deliver a passing lar brief through implementation, review and PR checks.
disable-model-invocation: true
---

Read the prose rules once, before writing: [Write prose](shared/write-prose.md),
plus [Write agent docs](shared/write-agent-docs.md) for skill files, `AGENTS.md`
or `CLAUDE.md`. Pass them in every subagent's brief: their paths and the
instruction to apply them while drafting all prose, not code. Subagent files
don't repeat them. Read each step and its references when reached. The user
verifies visible changes and merges PRs.
Follow the repository’s commit rules and [cross-repository citations](shared/cross-repo-citations.md).

1. Read [Builder](agents/builder.md) and follow its build, review, approval,
   checks and retro steps. Load each agent file only when assigning that role.
