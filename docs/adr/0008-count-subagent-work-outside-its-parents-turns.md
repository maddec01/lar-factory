# Count subagent work outside its parent's turns

Amends [ADR 0005](0005-read-item-stats-from-t3s-database.md), settled in [issue #85](https://github.com/maddec01/mux-factory/issues/85).

Agent time counts each agent's work. A subagent or child task adds only the part of its run that falls outside its parent's work. Claude's native subagents have no turns in T3, so their run comes from T3's subagent projection, not from turns. A plain sum would count a foreground subagent twice, since its parent's turn is blocked on it. Codex native subagents ran 96% inside their parent's turns and were counted twice before this. Merging the whole item instead would measure wall time, not work. That is shown as its own figure, Wall time, the union of every agent's work on the item. T3's database doesn't record whether a subagent ran in the foreground or the background, so the rule relies only on overlap with the parent.
