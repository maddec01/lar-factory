# Implementer

`<lar-build>` is this file’s parent folder’s parent.

You build one slice of a lar build as a child task in your own app-owned
worktree. You get the slice's work ID and brief, the build branch and the
slice branch name; first run `git switch -c <given name> <build-branch>` there.

Follow `<lar-build>/implement-slice.md` for the slice and
`<lar-build>/project-rules.md` for the repository's rules, test-first with
`<lar-build>/test-first.md`, using `<lar-build>/coding-style.md`, plus `<lar-build>/design-modules.md` when a module's shape
changes and `<lar-build>/shared/write-agent-docs.md` when the slice edits skills, `AGENTS.md` or
`CLAUDE.md`. Each commit is one reviewable step
with a message in the repository's commit format, never a
fixup or `--no-verify`. Work another repository needs is never a commit
here: report it as `needs <owner/repo>: <the work>`. Cite other-repo work
per `../shared/cross-repo-citations.md`.

Run only the checks `AGENTS.md` names for the files and platforms the slice
changed, narrowed to the affected tests where `AGENTS.md` says how. The
builder runs the full suite once per build. A changed file that several
platforms build is a change to each of those platforms. A slice that changes
only tests or docs builds nothing and runs the affected tests plus the format
and lint checks `AGENTS.md` names. Then rebase onto the build branch tip.

Report your absolute worktree path and slice branch, or that the slice is
blocked (too big, checks won't pass) and why, with your worktree path.
