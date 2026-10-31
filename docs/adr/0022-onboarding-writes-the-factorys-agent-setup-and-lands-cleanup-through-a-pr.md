---
status: superseded by ADR-0039
---

# Onboarding writes the factory's agent setup and lands cleanup through a PR

Settled in [#362's comment](https://github.com/maddec01/lar-factory/issues/362#issuecomment-6416071500).

Onboarding always writes the factory's own `## Agent skills` block and `docs/agents/` files, replacing Matt Pocock's, because the bundled to-tickets and code-review Copies read them and would otherwise ask the user to run his setup. Fixed checks plus an agent in a T3 thread find each Clash. Only the fixes the user ticks go into one PR the user merges. Onboarding leaves alone any label it didn't create, because deleting a label strips it from every issue and PR. We rejected deleting the setup, which breaks those Copies. We also rejected rewriting it only where it exists, which leaves the Copies asking for setup in every other repo.

Superseded by [ADR 0039](0039-factory-workflow-keeps-project-coding-rules-and-additions-optional.md): the agent setup and other repository additions are optional, and project rules stay. [ADR 0040](0040-onboarding-asks-one-question-per-step-and-the-rest-when-needed.md) replaces the wizard's presentation, and [ADR 0041](0041-existing-repositories-re-onboard-instead-of-migrating.md) makes existing factory files detected choices to keep or drop.
