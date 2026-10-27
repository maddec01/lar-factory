# Workflow labels have no colons, and the kind is a label on every provider

Settled in [#360's answer](https://github.com/maddec01/lar-factory/issues/360#issuecomment-6415970766).

The factory's workflow labels must work as GitHub labels and as Azure DevOps tags. Azure's docs neither ban nor confirm a colon in a tag, so we renamed `decision: grill` and its siblings to `decision-grill` and so on, and onboarding offers to rename the old labels. A repository's own custom labels may keep a colon. Azure work item types differ by process (Basic has only Epic, Issue and Task), so the kind is a tag there too rather than the type.
