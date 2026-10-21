# Pedro merges every PR

The factory's [recorded agreement](../plan.md#what-we-agreed) and current
[AGENTS.md](../../AGENTS.md) reserve every PR merge for Pedro; agents push
branches and open PRs, never push to `main` or merge.
This preserves the [stated division of responsibility](../../README.md): a
person decides and merges, while agents do the rest.
The [approver](../../skills/mux-work/agents/approver.md) therefore opens the PR
and recommends Verify or Ready to merge, and the
[builder](../../skills/mux-work/agents/builder.md) sets that status only after
required checks pass; neither role grants authority to merge.
