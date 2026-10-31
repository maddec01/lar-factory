# Factory progress stays on the machine

Settled in [#686](https://github.com/maddec01/lar-factory/issues/686) and [#692](https://github.com/maddec01/lar-factory/issues/692), built in [#694](https://github.com/maddec01/lar-factory/issues/694).

Status, the Queue, refinement progress, build phases, slices and review progress live only in work records on the user's machine, for every repository. No step writes them to a ticket's labels, tags, comments or Azure State. We chose this so that the user's own execution process doesn't manage the team's board: the team keeps its tickets and assignments, a published ticket describes work, and a build delivers a PR. The cost is that factory progress doesn't follow the user to another machine, and syncing it across machines is out of scope.

This supersedes [ADR 0020](0020-an-items-status-lives-on-the-item.md) and [ADR 0024](0024-the-board-moves-azure-state-only-when-its-category-changes.md). It amends these ADRs:

- [ADR 0017](0017-threads-start-from-the-board-once-nothing-blocks-them.md): a blocked part starts once the work it waits on is complete in its work records. A closed ticket completes nothing.
- [ADR 0019](0019-a-repositorys-provider-is-its-origins-host-and-an-item-source-only-lists-items.md): an item source supplies a ticket's context. Work enters the board only by local capture or an explicit pick, and the work record holds its Status and repository. A repository's provider is still its origin's host.
- [ADR 0023](0023-workflow-labels-have-no-colons-and-the-kind-is-a-label-on-every-provider.md): no repository needs the factory's workflow labels, and an item's kind lives in its work record.
- [ADR 0025](0025-an-azure-work-item-records-its-repository-in-a-repo-tag.md): the factory writes no `repo-` tag, and reads an old one only to place an existing work item.
- [ADR 0028](0028-each-item-source-reads-at-the-pace-of-its-work.md): source reads refresh ticket context and provider observations. The provider no longer holds an item's authoritative state.
