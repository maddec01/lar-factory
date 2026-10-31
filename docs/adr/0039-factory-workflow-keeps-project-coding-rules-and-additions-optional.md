# The factory workflow keeps project coding rules, and repository additions are optional

Settled in [#687](https://github.com/maddec01/lar-factory/issues/687) and [#689](https://github.com/maddec01/lar-factory/issues/689), built in [#694](https://github.com/maddec01/lar-factory/issues/694).

Every repository can decline Repository config, factory labels, agent guidance and repository domain docs. Each is a separate choice, and onboarding shows the concrete change for approval before a PR writes it. When the user declines repository guidance, the thread prompts carry the factory's guidance. When a repository has no domain docs, the factory keeps private drafts in work records by default, and new repository docs arrive only through a later approved build PR.

Factory threads follow the factory workflow and keep the project's instruction files, coding rules, required checks, commit format and PR requirements. Factory standards fill only the gaps. A different project workflow alone needs no cleanup. When a rule and the factory workflow can't both be met, the thread shows the Clash and asks the user. Project skills guide a build's code only when the user selects them, and a change to the selection applies to later builds. Bundled Copies stay unchanged, and explicit Overrides set aside what doesn't fit. The factory can't remove the startup context or project skills that Claude Code and Codex load themselves.

We chose this over writing the factory's agent setup into every repository and landing cleanup through a PR, because a team's repository shouldn't need factory files for one user to work on it. This supersedes [ADR 0022](0022-onboarding-writes-the-factorys-agent-setup-and-lands-cleanup-through-a-pr.md).
