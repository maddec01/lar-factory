---
name: lar-work
description: Take a queued lar issue from shaping to a Ready brief, for the board to start its build. Use when the user runs /lar-work with an issue.
argument-hint: "<owner/repo#n or issue URL>"
disable-model-invocation: true
---

You run one Lar Factory item. The user answers questions, picks prototypes,
verifies visible changes and merges every PR; the rest is yours.

## Rules

- **Prose**: before this thread writes anything, read `unslop` once
  (`~/.claude/skills/unslop/SKILL.md` in Claude Code,
  `~/.agents/skills/unslop/SKILL.md` in Codex). Apply its rules while drafting
  every piece of prose: chat, questions, issue comments, briefs, PR bodies,
  commit messages, docs and skill files (skill files also follow
  `writing-for-agents`). Write each text clean the first time rather than as a
  separate scan-and-rewrite pass, though unslop calls itself an editing pass.
  Code is out of scope. This holds for every thread that runs `/lar-work`:
  shaping, concept and decision threads, and a fresh thread resuming one after
  a handoff. Build threads get it from `agents/builder.md`.
- Move the issue's Status on the "lar" board at every step:
  `bash <this skill>/scripts/status.sh <owner/repo#n> "<Status>"`, or the work
  item's URL on Azure DevOps. Statuses:
  List, Queued, Shaping, Needs you, Ready, In progress, Review, Verify,
  Ready to merge. `status.sh` refuses Done: closing the issue, or completing
  the work item, makes it Done.
- Facts are yours to find; decisions are the user's. Read code, docs and history
  in **subagents**. Every factory subagent reports in ≤300 words, never whole
  files, logs or screenshots. Ask the user only what a subagent can't answer.
- **Tools**: `gh issue view <ref> --comments` and `gh issue comment` for
  issues, and on Azure DevOps the read and comment commands in
  [Azure DevOps](issue-tracker.md#azure-devops); `t3_thread_launch` for a handoff thread; a native subagent or a
  `delegate_task` child task per [Orchestration](orchestration.md) for
  delegated work; `AskUserQuestion` for ordinary questions to the user, following
  the [question guide](questions.md). Retro picks and their clarifications
  stay in chat. Call `orchestrator_capabilities` only to change a model or to
  read `inheritedOptions` before delegating; never search the tool catalogue.
- Read each linked file or skill only when its step runs.
- The issue is the only hand-over: brief, map, decisions and links live in its
  body and comments, so every step resumes from the issue alone.
- Past about 150k tokens, hand off: post a handoff written per
  `~/.agents/skills/handoff/SKILL.md` as an issue comment, then continue in a
  fresh thread with `t3_thread_launch`.
  - Shaping thread: `/lar-work <issue>` in the issue's repository project,
    `workspaceStrategy` `{"type":"root"}`.
  - Build thread: only while work before the PR step remains (slices, merges,
    a review round); otherwise finish in place (PR, status, retro). Past the
    mark, start no new implementers; merge the running ones, then hand off
    with the message from **5. Start the build** and `workspaceStrategy`
    `{"type":"existing_worktree","worktreePath":"<build worktree>","branch":"<build branch>"}`.
    The handoff names the step and review round to resume at; the open slice
    sub-issues carry the rest. At a review round it also lists the round's
    base sha, each reviewer's verdict, open findings, fixed findings, and
    rejected findings with reasons, and the unreviewed fixes so far, each as
    the line the builder's **Approve** describes.
- Never merge or push to `main`. Commit and PR rules are in each repo's
  `AGENTS.md`, except citing another repository's work, which follows
  [Cross-repository citations](cross-repo-citations.md).

## Grilling with docs

Wherever this skill grills (open questions in **2. Size up**,
[Concepts](concepts.md) step 1, `decision-grill`), load `grilling` and
`domain-modeling`, as upstream `grill-with-docs` does. Challenge the user's terms
against the repo's `GLOSSARY.md` and ADRs; capture each resolved term and
ADR-worthy decision the moment it settles.

Shaping, concept and decision threads run in the issue's repository project
(the T3 project on its repo's main checkout) with no
branch or PR, writing only to the issue and leaving the checkout as found. So
draft each glossary entry and ADR instead of writing it: record it in the
batch's answers comment, then in **Domain docs** of the brief (**3. Brief**) or
the map ([Concepts](concepts.md)). Drafts follow `domain-modeling`'s
`GLOSSARY-FORMAT.md` and `ADR-FORMAT.md`; an ADR draft meets its three
conditions. The builder writes them to the repo in the build PR.

## 1. Pick up

Read the issue with comments, parent, sub-issues and blockers, then route:

- **Unfinished retro capture record** (first, even over a passing brief):
  finish only that capture per [Retro capture](retro-capture.md), keeping the
  source status. Rerun no build or retro; start no shaping or thread. Report
  links and pending failures, then end this pickup, even if capture completes.
- A `decision-*` sub-issue: [Decisions](concepts.md#decisions).
- A `build` sub-issue, or a passing brief in the body, also when resuming a
  shaping handoff: set **Ready** if it isn't and stop; the board starts it
  (**5. Start the build**).
- Anything else: set Shaping. An **Explore subagent** reads the repo's
  `AGENTS.md`, `GLOSSARY.md`, relevant ADRs and the code this issue touches,
  and returns ≤300 words in `domain-modeling` vocabulary: what exists, where,
  and what the issue would change. It also returns each onboarded repository's **role**:
  `bash <this skill>/scripts/repo-config.sh --list` lists the repositories, and
  `bash <this skill>/scripts/repo-config.sh <owner/repo>` (or an Azure
  repository's origin URL or `<org>/<project>/<repo>`) prints one's config,
  read from its default branch (this checkout may be another repo's).

## 2. Size up

Pick the route yourself; never ask the user to pick one by name. Ask them to
confirm it ([question UI](questions.md)) in a few lines: what you understood
the item to be; the repositories that change, named from the repository
roles; the open questions, or "none";
and what happens next in plain
words ("I'll ask you three questions, then write the brief"; "a subagent
reproduces the bug first; I only ask you if the expected behaviour is
unclear"; "this is too big for one session, so I'll turn it into a concept
map"). Shaping ends at Ready, with the user starting each build from the board.

Add the kind label (`bug`, `feature`, `improvement`, `concept`), first running
[label setup](issue-tracker.md#label-setup) in the issue's repo if it lacks the
label. On Azure DevOps the kind is a tag, added with `retag`
([Tags](issue-tracker.md#tags)), and needs no setup. Anything the user adds or corrects is another open question. Then:

- **Bug**: first a **Diagnose subagent** with `diagnosing-bugs` returns the
  cause, the evidence and a failing test to write; its open questions join the
  list.
- **Open questions**: settle every one here by **Grilling with docs**, for bugs
  and features alike. A question of how something looks or feels gets a
  **Prototype** child task with `prototype`, started per
  [Orchestration](orchestration.md): two or three variants differing only on
  that question; a logic or state question gets an HTML page. It keeps its
  screenshots in its own context and returns each variant's start command (or
  HTML path), the worktree path, the branch, a preferred port and a short
  description. Show the variants as below, ask for the user's pick, and record it
  and the branch on the issue.

  **Showing prototypes.** This thread, or the thread of a `decision-prototype`
  sub-issue, shows every variant inside T3 itself, since the preview and Device
  panel belong to the thread that opens them. The user never receives a file
  path, URL or run command, and nothing opens outside T3. This overrides the
  `prototype` skill where it tells the agent to hand the user a file, URL or
  command: `LOGIC.md` "3. Build the shareable HTML file", "4. Hand it over"
  and "Anti-patterns", `UI.md` "5. Hand it over" and `SKILL.md` "Rules that
  apply to both".
  - Run the variants from the child task's worktree. Start each server on a
    port where `lsof -ti tcp:<port> -sTCP:LISTEN` prints nothing, bound to
    `127.0.0.1`, and note the PID that holds the port, not a launcher's.
  - Web and HTML: open the URL with `preview_open` (absolute http(s) URL, never
    `file://`). Serve a static HTML file's folder with
    `python3 -m http.server --bind 127.0.0.1 --directory <dir> <port>`.
  - Native iOS or Android: run the build and install scripts named in the
    target repo's `t3.json` and `AGENTS.md`, one variant at a time, then
    `device_open` (`device_list` finds the device id).
  - Say in chat which variant is showing. For another round, send the request
    to a Prototype child task.
  - When the user picks, or the thread ends without a pick, stop exactly the
    noted PIDs. An app left installed on the simulator stays.
  - If `preview_open` or `device_open` is unavailable or fails, stop, tell
    the user why and ask how to go on per [Questions](questions.md). Never fall
    back to anything outside T3.
- **Another repository changes** (its role says it serves or uses what this
  item changes): that work becomes a build there, a
  sub-issue of this issue that blocks it (reuse an open issue that covers it),
  with its own brief and gate. On Azure DevOps it's a child Task tagged
  `repo-<that repository>` that this item waits for
  ([Work in another repository](issue-tracker.md#children-and-blockers)).
  This issue's build starts once that one closes
  (**5. Start the build**). This issue is a build only if its own repository
  changes.
- **No open questions**: write the brief.
- **Too big or unclear for one session**: [Concepts](concepts.md).
  Repository count never makes an issue a concept.

## 3. Brief

Replace the issue body with the brief; the user's original text goes in a
collapsed `<details>` block at the end.

```markdown
## What
<the change, in the user's domain language>

## Done when
- <observable result a reviewer can check>

## Confirmed
- <each assumption the user confirmed, and each decision with a link>

## Notes for the builder
<where the code is, the failing test to start from, prototype branch to follow>

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry>, or "none"
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft>, or "none"

## Verify
<"yes" with why (visible, auth, migrations, deployment, hard to check), or "no">
```

## 4. Gate

1. A **Doubt subagent** gets only the path of
   [`agents/doubt.md`](agents/doubt.md), the brief and the repo path, no
   conversation. Fix what it finds.
2. In one batch, ask the user every assumption they haven't confirmed and every
   Doubt finding you can't fix.
3. Set **Ready** on each build: this issue if it's a build, and each build
   sub-issue found while shaping. Tell the user in chat which builds are Ready and
   which issue each waits on. This shaping thread is done; the user starts each
   build from the board (**5. Start the build**).

## 5. Start the build

The board's **Start build** on a Ready build is the user's Go. A build blocked by
another issue starts only once that issue closes, by hand or through the
board's **Start after**. With no repository project for the build's repo,
Start build stays disabled until the user adds the project in T3. Start build:

1. adds the `build` label (a tag on Azure DevOps), so the board shows the build's sub-issues as slices;
2. sets a parent that isn't a build to In progress, where it stays until a
   build's PR closes it ([Parent closing](issue-tracker.md#parent-closing));
3. starts the build thread in the build's repository project, in a new
   worktree on branch `<kind>/<n>-<slug>` from `main` (`fix` for a `bug`,
   `feat` for a `feature` or `improvement`, else `chore`), with the message
   `Build <owner/repo>#<n>. Read <installed lar-work>/agents/builder.md and follow it.`,
   where `<installed lar-work>` is this skill's absolute path.
