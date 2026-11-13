---
name: lar-build
description: Deliver a passing lar brief through implementation, review and PR checks.
disable-model-invocation: true
---

Read [prose](shared/prose.md) once and follow
[Builder](agents/builder.md). Read each stage only when reached; pass a role its
own instruction path, not the builder's stages. The user verifies changes and
merges every PR. Follow [project rules](project-rules.md) and
[cross-repository citations](shared/cross-repo-citations.md).

Shaping or correcting scope uses [Pick up](pick-up.md), [Size up](size-up.md),
[Brief](brief.md) and [Gate](gate.md) only as that route requires. A passing build
starts at Builder and does not repeat shaping.
