# Mux factory

A small software factory for [Mux](https://github.com/maddec01): the skills,
build agents and local board that take an idea from a list to a merged PR.
A person decides and merges; agents do the rest.

The [glossary](GLOSSARY.md) defines the factory's terms. Existing decisions are
recorded in [ADRs](docs/adr/): [local GitHub access](docs/adr/0001-use-the-local-gh-login.md),
[Pedro merges every PR](docs/adr/0002-pedro-merges-every-pr.md),
[Start in Mux, build in the issue repository](docs/adr/0003-start-in-mux-build-in-the-issue-repository.md), and
[item stats from T3 Code's database](docs/adr/0005-read-item-stats-from-t3s-database.md).

It's built for Mux, but the parts are plain [Agent Skills](https://agentskills.io)
and a small board app, so you can borrow them. Issues and ideas are welcome.

## How work moves

Work lives in GitHub Issues, one repo per platform (`mux-server`, `mux-apple`),
and on one GitHub Project, "Mux", whose Status column is the board:

```
List → Queued → Shaping ⇄ Needs you → Ready → In progress → Review → Verify / Ready to merge → Done
```

1. **List.** Capture bugs, features and ideas as issues.
2. **Queued.** Pick one by moving it to Queued, then run `/mux-work <owner/repo#n>`
   in a new thread. Nothing starts without this.
3. **Shaping.** `mux-work` reads the issue and the code through subagents, and
   proposes a route:
   - **clear**: a bug a subagent can reproduce and diagnose, or a small change;
   - **needs decisions**: it grills you with docs: questions that check your
     terms against the project's glossary and ADRs, and drafts any new terms
     and decisions into the brief for the builder to write. For anything
     visual, it builds two or three prototypes for you to pick from;
   - **foggy**: the issue becomes a **concept**. Its body is a map (destination,
     decisions so far, fog, out of scope, domain docs drafts, a diagram), and
     each decision is its own sub-issue, worked in its own thread. Build
     sub-issues appear as decisions close.
4. **Ready.** It writes a brief into the issue (what, how to tell it's done,
   confirmed assumptions, domain docs drafts). A fresh-context subagent tries
   to find holes in it.
5. **In progress.** A new thread builds it in its own git worktree, test-first,
   from the brief alone.
6. **Review.** Four reviewers run in parallel, each with fresh context: code,
   security, UX and UI (browser preview or simulator). At most two rounds of fixes.
7. **Verify or Ready to merge.** An approver opens the PR. Anything visible, risky
   (auth, migrations, deployment) or not fully checked goes to Verify with test
   steps; the rest goes to Ready to merge. The item stays in Review until the
   PR's required checks pass; a CI fixer subagent handles failures, and after
   two tries or a runner problem the item goes to Needs you.
8. **Retro and merge.** After the final review status is set and PR monitoring
   stops, the build thread ends with suggested improvements for you to pick.
   Picks become follow-up issues in the owning repos (or reuse matching open
   issues); new issues enter List. Shared/global work goes to Factory, and one
   suggestion spanning repos becomes one Factory concept for later shaping.
   Capture leaves the source status unchanged and implements none of the picks.
   Its source-issue record tracks links and unfinished steps; rerun
   `/mux-work <source-owner/repo#n>` to resume capture only, even with a passing
   brief. See [Retro capture](skills/mux-work/retro-capture.md) for routing,
   recovery and privacy rules. You merge the original PR to reach **Done**.

**Needs you** means it's waiting on you: a question, a prototype choice or a
review.

Before using the workflow in a destination repository, follow
[issue-tracking setup](skills/mux-work/issue-tracker.md#label-setup) to create
missing workflow labels while preserving existing ones. The same guide covers
native parent/sub-issue and blocked-by commands. Status stays a Project field.

Every thread starts small: steps hand over through the issue and the PR, never
through a long conversation, and subagents return summaries instead of files.

## Skills

| Skill | What it does | Source |
| ----- | ------------ | ------ |
| `mux-work` | Runs one item: size up, shape, brief, gate, start the build | Mux |
| `mux-work/agents/` | Builder, Doubt, four reviewers, approver, CI fixer | Mux |
| `skill-sync` | Brings upstream changes into the copies, by your choice | Mux |
| `grilling`, `domain-modeling`, `prototype`, `research`, `diagnosing-bugs`, `tdd`, `code-review`, `codebase-design`, `writing-for-agents`, `pr`, `retro`, `handoff`, `to-tickets`, `implement` | Shaping and building; `code-review` is for reviewing by hand, and no `mux-work` file loads it | Copies of [mattpocock/skills](https://github.com/mattpocock/skills) |
| `code-review-and-quality`, `security-and-hardening`, `doubt-driven-development`, `frontend-ui-engineering`, `browser-testing-with-devtools` | Source for the Doubt and reviewer checklists in `mux-work/agents/`; not loaded by them | Copies of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) |
| `developer-profile` | Pedro's coding style, which the builder follows | Copy of [maddec01/developer-profile-skill](https://github.com/maddec01/developer-profile-skill) |

`UPSTREAM.md` lists the upstream path and commit of every copy.

### Install

From a clone of `main`, run:

```sh
bash scripts/install.sh
```

It installs every skill globally for Claude Code and Codex with the
[`skills` CLI](https://github.com/vercel-labs/skills). Then it copies the shared
checklists from `references/` on `main` to `~/.agents/references/` and
`~/.claude/references/`, which is where the copied skills' `../../references/`
links point. It ends by checking that those links resolve. It needs `npx` and a
`gh` login.

The skill list is `SKILLS` in the script. If you run `npx skills add` yourself,
always pass `-a`: `-y` without it installs into every agent the CLI knows.

The CLI installs Claude's shared links in `~/.claude/skills`. If you also use
extra Claude config directories such as `~/.claude-personal`, create those
directories first, then synchronize their skills:

```sh
node board/scripts/sync-claude-skills.ts
```

This links only skills that `~/.claude/skills` already symlinks into
`~/.agents/skills`, using relative links in each existing `~/.claude-*/skills`.
It creates missing `skills` directories, preserves files and unrelated links,
and lists conflicting destinations with a nonzero partial-update result.
Resolve the conflicts yourself and rerun; other eligible links are still added.

### Update

The copies change only when a `skill-sync` PR merges here. Run `/skill-sync` to
see what changed upstream and pick what to take; after merging, pull `main` and
run the install again:

```sh
git pull && bash scripts/install.sh
```

It updates the skills, adds newly listed ones, and replaces the checklists with
the ones on `main`.

To update the installed board and the skills together, press **Update** in the
board's header, or run from the main factory checkout:

```sh
bash board/scripts/update.sh
```

The command requires macOS with a logged-in launchd GUI session, Node 22.18+
with npx, pnpm (`brew install pnpm`), Git, and a logged-in `gh`. Install the T3
Code CLI for the board's Start button. It checks that the checkout is clean and
on `main`, fetches `origin/main`, fast-forwards, runs
`pnpm install --frozen-lockfile` in `board/` (replacing a `node_modules` that
npm made), reinstalls/restarts the launch agent, and waits up to 15 seconds for
the expected running revision and new launch identity. Then it runs
`scripts/install.sh`, which adds newly listed skills and replaces the checklists
with the ones on `main`, and synchronizes extra Claude profiles as above. The launch-agent configuration is refreshed too.
When the checkout and the running board are already on `origin/main`, it skips
the install and the restart and only updates the skills and profiles.

Dirty, detached, local-ahead or diverged checkouts stop before installation or
restart; your commits are never reset, rebased or merged into a new commit.
Failures name the step and return nonzero. Completed steps are kept, so an
update can be partial; resolve the reported problem and rerun. A launchctl
success alone is not success: a crash, bind failure or old process answering
on the port fails readiness. Check `~/Library/Logs/mux-board.log` in that case.

One update runs at a time, from the button or a terminal. Each run writes its
output to `~/Library/Logs/mux-board-update.log` and its progress and lock to
`~/Library/Application Support/mux-factory-board/`, outside the checkout; a lock
left by a dead process is cleared on the next run.

### Avoiding conflicts

The `skills` CLI keeps one source per skill name. Installing `grilling` from
here makes this repo its source, and updates come from here from then on.

- To add other skills from Matt or Addy, add them **by name**:
  `npx skills add mattpocock/skills -g -s <name>`. Never add a whole repo at
  once: that would switch the copies back to upstream.
- Mux's own skills use a `mux-` prefix, so they never collide.
- Copies are never edited for Mux. Mux rules live in `mux-work` and in each Mux
  repo's `AGENTS.md`, so the copies stay safe to use in any project.

## Board

`board/` is a local app that shows the Mux project: what needs you, what's in
flight, concepts and their progress, and where every item sits in the flow. It
reads GitHub through your local `gh` login and refreshes itself. See
[`board/README.md`](board/README.md).

## Repo layout

```
skills/            copies (original names), mux-work (with agents/), skill-sync
board/             the local board app
references/        checklists Addy's skills link to
scripts/install.sh installs or updates the skills and checklists
scripts/setup-worktree.sh installs board/ in a new worktree (.githooks, t3.json)
config.json        Mux repos, board port and refresh, pickup limits
UPSTREAM.md        source and commit of every copy
docs/plan.md       how this was set up
```

## Credits and licence

MIT, see [LICENSE](LICENSE). The copied skills are by Matt Pocock and Addy
Osmani, both MIT; their notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The factory idea draws on
ZazenCodes' [Build Your Own AI Software Factory](https://www.youtube.com/watch?v=ctoaIC4LHmI).
