# Local settings can inherit optional team defaults

Settled in [#687](https://github.com/maddec01/lar-factory/issues/687), built in [#694](https://github.com/maddec01/lar-factory/issues/694).

Every repository works from local settings on the user's machine, with no Repository config. An optional `.lar-factory.json` supplies team-shared defaults beneath the user's explicit local overrides, and removing an override inherits the default again. Credentials and write consent stay local. A shared change lands through a PR, and the board offers to accept it without repeating onboarding. A change to the item source or the domain-doc location pauses only the work it affects, while other work goes on. When the shared file is invalid or unreadable, the board keeps the last usable setup and shows why. We chose layering over a repository-held setup so that a repository whose team doesn't want factory files can still be onboarded, and a teammate who does onboard it still reuses the shared answers.

This supersedes [ADR 0021](0021-repository-config-lives-in-the-repository.md), which required every repository to hold its setup.
