# An Azure work item records its repository in a repo- tag

Settled in [#378's decision](https://github.com/maddec01/lar-factory/issues/378#issuecomment-6421107991).

An Azure DevOps work item belongs to a project, and one team's sprint can hold items for several repositories, some not onboarded. When someone takes an item from a repository's List, shaping writes a `repo-<name>` tag naming that repository, and the board matches it by name, ignoring case, against the repositories that read the item's item source. Until then the item shows in every List that reads the source, and the board never guesses. We chose a tag over a custom field because any Contributor can write tags while a field needs a Project Collection Administrator, and over keeping the choice on the Mac because the ticket must carry its own tracking.

Amended by [ADR 0036](0036-factory-progress-stays-on-the-machine.md) and [ADR 0041](0041-existing-repositories-re-onboard-instead-of-migrating.md): the factory writes no `repo-` tag, and the work record holds its repository. The board reads an old tag only to place an existing work item among the repositories that share its team.
