Ported from mattpocock/skills, `skills/engineering/implement/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md) for the Ports record.

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Follow `test-first.md` at pre-agreed seams.

Run only the checks AGENTS.md names for the changed files. The builder runs the full suite once per build.

The builder arranges review after slices are integrated.

Commit your work to the current branch.
