# Workflow labels have no colons, and the kind is a label on every provider

Settled in [#360's answer](https://github.com/maddec01/lar-factory/issues/360#issuecomment-6415970766).

The factory's workflow labels must work as GitHub labels and as Azure DevOps tags. Azure's docs neither ban nor confirm a colon in a tag, so we renamed `decision: grill` and its siblings to `decision-grill` and so on, and onboarding offers to rename the old labels. A repository's own custom labels may keep a colon. Azure work item types differ by process (Basic has only Epic, Issue and Task), so the kind is a tag there too rather than the type.

Amended by [ADR 0036](0036-factory-progress-stays-on-the-machine.md): no repository needs the factory's workflow labels, and an item's kind lives in its work record. Onboarding reads old status labels and tags once, at import ([ADR 0041](0041-existing-repositories-re-onboard-instead-of-migrating.md)).

Amended by [ADR 0042](0042-refinement-publishes-only-finished-work-in-the-teams-terms.md), built in [#695](https://github.com/maddec01/lar-factory/issues/695): publication uses the team's detected types, labels or tags through an optional Vocabulary mapping, with no mandatory factory labels. The mapping pairs concept, build and each kind with team terms or nothing. A ticket has at most one effective provider type. Applicable labels or tags combine, but conflicting type mappings require the user to choose one effective type or none before approving publication. Unsupported capabilities remain unavailable. Kind remains authoritative in the private work record.
