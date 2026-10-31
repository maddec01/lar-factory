---
status: superseded by ADR-0036
---

# An item's status lives on the item

Settled in [#354's decision](https://github.com/maddec01/lar-factory/issues/354#issuecomment-6416457322).

Each item keeps its status on its own provider, in the form its item source allows: a `status-` label on a GitHub issue or a `status-` tag on an Azure work item. Done is never stored; an item is Done when it closes. On Azure the board also moves the work item's State, but only when the state category changes, so the team's own states are left alone. We chose this over a local status store so that status travels with the ticket to any machine, and over Azure state categories alone because five categories can't hold ten statuses.

Superseded by [ADR 0036](0036-factory-progress-stays-on-the-machine.md): Status lives in the work record on the user's machine. Onboarding reads a `status-` label or tag once, at import ([ADR 0041](0041-existing-repositories-re-onboard-instead-of-migrating.md)).
