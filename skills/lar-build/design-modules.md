Ported from mattpocock/skills, `skills/engineering/codebase-design/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md).

# Design modules

Design deep modules: much behavior behind a small interface, at a testable seam.
Use these terms consistently rather than substituting component, service or API:

- A module has one interface and an implementation, at any scale from function
  to package or tier-spanning slice.
- Its interface is everything callers must know: types, invariants, ordering,
  errors, configuration and performance, not merely public methods or a
  TypeScript `interface`.
- Its implementation is the internal code. An adapter describes a role at a
  seam, not implementation size.
- Depth is behavior available per amount of interface callers must learn.
  Deep means much behavior behind little interface; shallow means comparable
  interface and implementation complexity. Do not measure depth by line ratio.
- A seam is where behavior can vary without editing that place. Its placement
  is a separate decision from the implementation. Avoid "boundary", which also
  means a bounded context.
- An adapter satisfies an interface at a seam.
- Leverage is callers' capability per interface learned. Locality means change,
  knowledge, bugs and verification concentrate in one place for maintainers.

Reduce methods, simplify parameters and hide complexity. Depth belongs to the
interface; internal parts can remain small and replaceable. Private seams used
by internal tests need not become external interfaces. The deletion test asks
whether removing a module eliminates complexity, suggesting a pass-through,
or spreads it among callers, showing its value.

Callers and tests use the same interface. Testing past it suggests the module
has the wrong shape. Introduce a seam only when at least two adapters actually
justify it. Accept dependencies instead of constructing them internally;
prefer returned results to side effects and small interfaces to elaborate setup.

When deepening a cluster, read [Deepening](deepen-module.md). When the user asks
for alternative interfaces, read [Compare designs](compare-module-designs.md).
