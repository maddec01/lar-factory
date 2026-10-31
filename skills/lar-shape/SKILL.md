---
name: lar-shape
description: Take a queued lar work record through shaping to a Ready brief.
argument-hint: "<work ID, owner/repo#n or ticket URL>"
disable-model-invocation: true
---

You run one Lar Factory item. The user answers questions, picks prototypes,
verifies visible changes and merges every PR.

## Rules

Read [prose rules](shared/prose.md) before writing. Read each step and its
linked references only when reached. The work record is the handover: keep its
brief, map, decisions and blockers there through `lar-work` and the shared
scripts, per [work records](shared/issue-tracker/work-records.md), never in a
ticket. Move Status at each step with `status.sh`.
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

When refinement finishes or the user later asks to publish, read
[publication](shared/issue-tracker/publication.md). Publication keeps its own
approval and recovery journal and leaves Ready and Start build separate.
