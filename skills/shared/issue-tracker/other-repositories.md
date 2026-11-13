# Other repositories

Route each part of the work that another repository needs by that repository.
`bash <this skill>/shared/scripts/repo-config.sh --list` lists the onboarded
repositories, and `repo-config.sh --connections <owner/repo>` prints the ones
connected to this one.

- An onboarded repository is one the user can change. A Connection grants no
  permission to act. When the work needs a change in a connected onboarded
  repository, describe the required part and shape it within the user's authorized scope.
  Ask only when it adds scope the user has not authorized. Make it with
  `slice.sh <parent> "<title>" <brief-file> --kind build --repository <owner/repo>
  [--blocked-by <work ID>]...` under its concept or linked-work parent, and
  shape it in that repository. An onboarded
  repository that isn't connected comes into play only when the user names it.
- In a repository that is not onboarded, read code, docs and tickets for
  context and write nothing there. When required work is there, keep refining
  and offer the user both choices: add it to shape its part, or record a
  Dependency for the team that owns it. Onboard or change a repository only on
  the user's choice.
- When the login cannot push a branch or deliver a fork PR to a repository,
  explain the block to the user and offer a Dependency.

Record a Dependency on the work that needs it with
`lar-work add-dependency <work ID> --file <file>`. The JSON's `need` says what
is needed and why, and `owner` names the owning repository or team;
`lar-work --help` lists the optional fields. It prints the Dependency ID. Hold
each build that waits on it with
`lar-work add-dependency-block <Dependency ID> --revision N --build <work ID>`.
Send its request to the owning team per
[Dependency requests](publication.md#dependency-requests).

A Dependency is met only when the user marks it met
(`lar-work mark-met <Dependency ID> --revision N --identity <user>`). A closed
ticket proves neither deployment nor the contract. After the handover, read
that team's ticket and PRs to follow the work, and leave the ticket as the team
keeps it: never edit, assign, move or close it.

Onboarding the repository later keeps its Dependencies. Replacing one with a
build is the user's choice and needs their approval of the plan. Once they
approve, make the build as above and run
`lar-work replace-dependency <Dependency ID> --revision N --build <work ID>`.

After group Dependency changes, follow [Reconcile group](../reconcile-group.md).
