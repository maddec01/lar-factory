Ported from mattpocock/skills, `skills/engineering/codebase-design/DESIGN-IT-TWICE.md`. See [UPSTREAM.md](../../UPSTREAM.md).

# Compare module designs

When the user asks for alternatives for a chosen deepening candidate, show
its constraints, dependency categories from [Deepening](deepen-module.md),
and an illustrative code sketch, not a proposal. Then proceed without waiting.

Delegate at least three parallel designs with distinct constraints: minimal
interface of 1–3 entry points, maximum flexibility, and simplest common caller.
Add a ports/adapters design when useful. Give each a technical brief with paths,
coupling, dependency categories and what the seam hides, plus vocabulary from
[Design modules](design-modules.md) and the project glossary.

Each returns a radically different interface, including types, methods,
parameters, invariants, ordering and errors; a usage example; hidden behavior;
dependency/adapters strategy; and trade-offs in leverage.

Show designs sequentially, compare depth, locality and seam placement in prose,
then recommend one with reasons, or a hybrid when combining elements improves it.
