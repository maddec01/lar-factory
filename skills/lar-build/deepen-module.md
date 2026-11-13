Ported from mattpocock/skills, `skills/engineering/codebase-design/DEEPENING.md`. See [UPSTREAM.md](../../UPSTREAM.md).

# Deepening

Use [Design modules](design-modules.md)'s vocabulary. Classify dependencies:

- In-process computation/state: merge and test the new interface directly.
- Local-substitutable dependencies, such as Postgres with PGLite: deepen when
  the stand-in exists and run it in tests. Keep this seam internal.
- Remote services you own: inject transport through a port. The deep module
  owns logic; production uses HTTP/gRPC/queues, tests an in-memory adapter.
- True third-party services: inject a port and supply a mock adapter in tests.

A port needs at least two justified adapters, normally production and test.
Keep private test seams out of the external interface. Once new interface tests
cover the behavior, replace the old shallow-module unit tests rather than
layering redundant suites. Assert observable outcomes, not internal state;
tests should survive implementation refactors.
