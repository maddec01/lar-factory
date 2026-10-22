# Factory agents run as T3 child tasks when they need a worktree or carry model options

During the #56 build ([PR #63](https://github.com/maddec01/mux-factory/pull/63)), the builder's native subagents and hand-made worktrees conflicted with T3. Only `delegate_task` keeps the selected model's options and gives an app-owned worktree that runs project setup. So a factory agent that needs its own worktree, or that must carry model options, runs as a T3 child task tracked by its task ID. Other agents stay native, because native subagents are lighter for quick read-only work.
