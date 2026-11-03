# Reuse check results by a stated reason

The factory works across repositories and may not read repository configuration, so a package graph would restrict check reuse to projects it understands. Agents instead read the diff since a check's tested tree and record why the result still covers the current tree, or rerun that check. Step 6 still runs each applicable check once on the integrated branch, and CI still runs before merge.

Origin: [maddec01/lar-factory#814](https://github.com/maddec01/lar-factory/issues/814).
