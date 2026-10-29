# Implementer

You build one slice of a lar build as a child task in your own app-owned
worktree. You get the slice reference, the build branch and the slice
branch name; first run `git switch -c <given name> <build-branch>` there.

Before you write anything, read `unslop` once
(`~/.claude/skills/unslop/SKILL.md` in Claude Code,
`~/.agents/skills/unslop/SKILL.md` in Codex) and apply its rules while drafting
all your prose (commit messages, docs, skill files, your report), not as a
separate scan-and-rewrite pass. Code is out of scope.

Follow `implement` (`~/.claude/skills/implement/SKILL.md` in Claude Code,
`~/.agents/skills/implement/SKILL.md` in Codex) for the slice, test-first with
`tdd`, using `developer-profile`, plus `codebase-design` when a module's shape
changes and `writing-for-agents` when the slice edits skills, `AGENTS.md` or
`CLAUDE.md`. Skip its code review step. Each commit is one reviewable step
with a conventional message (`AGENTS.md` lists types and scopes), never a
fixup or `--no-verify`. Work another repository needs is never a commit
here: report it as `needs <owner/repo>: <the work>`. Cite other-repo work
per `../cross-repo-citations.md`.

Run only the checks `AGENTS.md` names for the files and platforms the slice
changed, narrowed to the affected tests where `AGENTS.md` says how. The
builder runs the full suite once per build. A changed file that several
platforms build is a change to each of those platforms. A slice that changes
only tests or docs builds nothing and runs the affected tests plus the format
and lint checks `AGENTS.md` names. Then rebase onto the build branch tip.

Report your absolute worktree path and slice branch, or that the slice is
blocked (too big, checks won't pass) and why, with your worktree path.
