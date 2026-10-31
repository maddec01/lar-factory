# Project rules

Honor existing project instructions and coding conventions. Read applicable
`AGENTS.md` or `CLAUDE.md` files when present, plus relevant contributor docs,
formatting rules, commit conventions and PR templates. They are optional input,
not a prerequisite for shaping or building. Factory guidance travels in the
thread and subagent prompts. Do not offer repository setup, guidance files or a
setup PR.

When instructions are absent, infer conventions from neighboring code and
existing tests. Inspect package scripts, manifests and CI to select test,
typecheck, lint and build commands for the changed layers. Use those commands
where later steps say "project checks". A full check suite means the applicable
project suite discovered here. Missing instructions never block work.

Take extra coding guidance from the project skills selected for this build.
`lar-work read <build work ID> | jq -r '.skills[]'` prints the Start build snapshot.
Read only the relevant sections you have not already seen. The repository's
conventions take precedence over lar-build's fallback style and test process.

Continue within the user's authorized scope. Ask only about a real unresolved
conflict, such as a rule demanding a push to main, or a PR check requiring a ticket
this build lacks. Show both requirements with their sources and a concrete way
forward per [questions](shared/questions.md). Do not repeat an approval already
given in the session.

Read the local domain-doc setting per
[where domain docs live](shared/domain-docs.md#where-domain-docs-live).

## Base branch

Resolve the build's base branch before creating its worktree. Use an existing
PR's target when continuing that PR, or an explicit target in the brief.
Otherwise use the remote's default branch. Read `refs/remotes/origin/HEAD`,
refreshing it with `git remote set-head origin --auto` when absent. Keep the
resolved name as `base_branch` and pass it to implementers, reviewers and the
approver. Substitute it in every diff, rebase and PR target below. Never assume
a repository's default branch is named `main`.
