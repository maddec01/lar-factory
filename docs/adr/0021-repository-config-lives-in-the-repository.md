---
status: superseded by ADR-0038
---

# Repository config lives in the repository

Settled in [#355's decision](https://github.com/maddec01/lar-factory/issues/355#issuecomment-6416486189).

Each onboarded repository holds its role, item source and labels in `.lar-factory.json` at its root, read only from the default branch, while the machine keeps just the list of onboarded repositories and board-wide settings. We picked the repository over the board app's data folder so that anyone who onboards the same repository reuses one setup and agents in any checkout see the same answer. The cost is that every config change, including a new setting from an app update, lands through a PR, so the app reads old files with defaults and only offers that PR rather than requiring it.

Superseded by [ADR 0038](0038-local-settings-can-inherit-optional-team-defaults.md): every repository works from local settings, and `.lar-factory.json` holds only optional shared defaults beneath local overrides.
