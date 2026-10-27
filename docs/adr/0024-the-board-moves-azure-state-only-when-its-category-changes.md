# The board moves Azure State only when its category changes

Settled in [#354's decision](https://github.com/maddec01/lar-factory/issues/354#issuecomment-6416457322) and the [#363 gate answers](https://github.com/maddec01/lar-factory/issues/363#issuecomment-6420598088).

An Azure work item keeps its factory status in a `status-` tag, and its State belongs to the team's process, whose states differ by process and team. The board moves State only across categories: to the first InProgress-category state when work starts, to the first Proposed-category state when it goes back to List or Queued, and to a Removed-category state on Abandon, while a merged PR completes the item. We chose this over mapping each status to a state because five categories can't hold ten statuses and teams rename their states, and over never touching State because the team's own boards would then show started work as new.
