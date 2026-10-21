# Mux factory

A small software factory for [Mux](https://github.com/maddec01): the skills,
build agents and local board that take an idea from a list to a merged PR.
A person decides and merges; agents do the rest.

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
   - **needs decisions**: it grills you with questions and, for anything visual,
     builds two or three prototypes for you to pick from;
   - **foggy**: the issue becomes a **concept**. Its body is a map (destination,
     decisions so far, fog, out of scope, a diagram), and each decision is its
     own sub-issue, worked in its own thread. Build sub-issues appear as
     decisions close.
4. **Ready.** It writes a brief into the issue (what, how to tell it's done,
   confirmed assumptions). A fresh-context subagent tries to find holes in it.
5. **In progress.** A new thread builds it in its own git worktree, test-first,
   from the brief alone.
6. **Review.** Four reviewers run in parallel, each with fresh context: code,
   security, UX and UI (browser preview or simulator). At most two rounds of fixes.
7. **Verify or Ready to merge.** An approver opens the PR. Anything visible, risky
   (auth, migrations, deployment) or not fully checked goes to Verify with test
   steps; the rest goes to Ready to merge.
8. **Done.** You merge. The build thread ends with a retro: suggested fixes to
   the skills and checks, for you to pick from.

**Needs you** means it's waiting on you: a question, a prototype choice or a
review. You get a push notification each time.

Every thread starts small: steps hand over through the issue and the PR, never
through a long conversation, and subagents return summaries instead of files.

## Skills

| Skill | What it does | Source |
| ----- | ------------ | ------ |
| `mux-work` | Runs one item: size up, shape, brief, gate, start the build | Mux |
| `mux-work/agents/` | Builder, four reviewers, approver | Mux |
| `skill-sync` | Brings upstream changes into the copies, by your choice | Mux |
| `grilling`, `domain-modeling`, `prototype`, `research`, `diagnosing-bugs`, `tdd`, `code-review`, `codebase-design`, `writing-for-agents`, `pr`, `retro`, `handoff` | Shaping, building and reviewing | Copies of [mattpocock/skills](https://github.com/mattpocock/skills) |
| `code-review-and-quality`, `security-and-hardening`, `doubt-driven-development`, `frontend-ui-engineering`, `browser-testing-with-devtools` | Reviews and the gate | Copies of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) |

`UPSTREAM.md` lists the upstream path and commit of every copy. The builder also
uses [`developer-profile`](https://github.com/maddec01/developer-profile-skill),
which lives in its own repo.

### Install

With the [`skills` CLI](https://github.com/vercel-labs/skills), globally, naming
each skill and the agents you use:

```sh
npx skills add maddec01/mux-factory -g -a claude-code codex \
  -s mux-work skill-sync grilling domain-modeling prototype research \
     diagnosing-bugs tdd code-review codebase-design writing-for-agents pr \
     retro handoff code-review-and-quality security-and-hardening \
     doubt-driven-development frontend-ui-engineering browser-testing-with-devtools
```

Always pass `-a`: `-y` without it installs into every agent the CLI knows.

### Update

The copies change only when a `skill-sync` PR merges here. Run `/skill-sync` to
see what changed upstream and pick what to take; after merging, run:

```sh
npx skills update -g
```

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
config.json        Mux repos, board port and refresh, pickup limits
UPSTREAM.md        source and commit of every copy
docs/plan.md       how this was set up
```

## Credits and licence

MIT, see [LICENSE](LICENSE). The copied skills are by Matt Pocock and Addy
Osmani, both MIT; their notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The factory idea draws on
ZazenCodes' [Build Your Own AI Software Factory](https://www.youtube.com/watch?v=ctoaIC4LHmI).
