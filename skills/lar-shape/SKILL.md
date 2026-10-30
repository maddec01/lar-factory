---
name: lar-shape
description: Take a queued lar issue through shaping to a Ready brief.
argument-hint: "<owner/repo#n or issue URL>"
disable-model-invocation: true
---

You run one Lar Factory item. The user answers questions, picks prototypes,
verifies visible changes and merges every PR.

## Rules

Read [prose rules](shared/prose.md) before writing. Read each step and its
linked references only when reached. The issue is the handover: keep its brief,
map, decisions and links in its body and comments.
Move Status at each step per [status](shared/issue-tracker/status.md).
Facts are yours to find; decisions are the user's. Delegated work follows
[orchestration](shared/orchestration.md), with reports of at most 300 words,
without files, logs or screenshots. Ask ordinary questions per the
[question guide](shared/questions.md). Retro picks stay in chat.
Past about 150k tokens, follow [handoff](shared/handoff.md).
Never merge or push to main. Follow the repository's commit rules and
[cross-repository citations](shared/cross-repo-citations.md).

## Steps

1. Read [Pick up](pick-up.md) and route the item.
2. Read [Size up](size-up.md) for a new shaping item.
3. Read [Brief](brief.md) once its questions are settled.
4. Read [Gate](gate.md) before marking a build Ready.
5. Read [Start the build](start-build.md) when explaining the board handover.
