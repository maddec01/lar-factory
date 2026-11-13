---
name: lar-shape
description: Shape any issue or local work record into a map or Ready brief, independently of building it.
argument-hint: "<work ID, owner/repo#n or ticket URL>"
disable-model-invocation: true
---

You shape one work record. Read [prose](shared/prose.md) once and
[work records](shared/issue-tracker/work-records.md). Read stages only as reached.
Leave product changes for Build; keep prototypes on their branch. Never merge
or push the default branch. Follow project commit rules and
[cross-repository citations](shared/cross-repo-citations.md).

- New or resumed work: [Pick up](pick-up.md), then its selected route.
- Fresh shaping: [Size up](size-up.md); settled questions go to
  [Brief](brief.md), then [Gate](gate.md). Shaping ends at Ready.
- Concept: after confirming understanding, [Concepts](concepts.md).
- Decision: pick-up routes to [Decisions](decisions.md), then only its method.
- Gate-only with a resolved work ID and saved brief: [Gate](gate.md) directly.
- Build-time correction uses the same Brief and Gate, then returns to the
  paused build's recorded phase; it starts no second build.
- Implementation requested later: [Start build](start-build.md).

When asking, read [Questions](shared/questions.md). When delegating, read
[Orchestration](shared/orchestration.md) and pass its path and **Wait for delegated
work** instruction; act only on complete reports. Past about 150k tokens read
[Handoff](shared/handoff.md). For a structural publication question, read
[Publication](shared/issue-tracker/publication.md).

Pass exact role paths, relative to this skill; sections are instructions too:

| Role | Instructions |
| --- | --- |
| explore | `pick-up.md#explore` |
| diagnose | `diagnose-bug.md` |
| research | `research-question.md` |
| prototype | `prototype-question.md` plus `prototype-ui.md` or `prototype-logic.md` |
| doubt | `doubt.md` |
