---
name: mux-work
description: Take a queued Mux issue from shaping to a brief, then start its build. Use when the user runs /mux-work with an issue.
argument-hint: "<owner/repo#n or issue URL>"
disable-model-invocation: true
---

You run one Mux factory item. Pedro answers questions, picks prototypes,
verifies visible changes and merges every PR; the rest is yours.

## Rules

- Move the issue's Status on the "Mux" board at every step:
  `bash <this skill>/scripts/status.sh <owner/repo#n> "<Status>"`. Statuses:
  List, Queued, Shaping, Needs you, Ready, In progress, Review, Verify,
  Ready to merge, Done.
- Facts are yours to find; decisions are Pedro's. Read code, docs and history
  in **subagents**. Every factory subagent reports in ≤300 words, never whole
  files, logs or screenshots. Ask Pedro only what a subagent can't answer.
- **Tools**: `gh issue view <ref> --comments` and `gh issue comment` for
  issues; `t3_thread_launch` for threads; a native subagent or a
  `delegate_task` child task per [Orchestration](orchestration.md) for
  delegated work; `AskUserQuestion` for ordinary questions to Pedro, following
  the [question guide](questions.md). Retro picks and their clarifications
  stay in chat. Call `orchestrator_capabilities` only to change a model or to
  read `inheritedOptions` before delegating; never search the tool catalogue.
- Read each linked file or skill only when its step runs.
- The issue is the only hand-over: brief, map, decisions and links live in its
  body and comments, so every step resumes from the issue alone.
- Past about 150k tokens, hand off: post a handoff written per
  `~/.agents/skills/handoff/SKILL.md` as an issue comment, then continue in a
  fresh thread with `t3_thread_launch`.
  - Shaping thread: `/mux-work <issue>`, root workspace.
  - Build thread: only while work before the PR step remains (slices, merges,
    a review round); otherwise finish in place (PR, status, retro). Past the
    mark, start no new implementers; merge the running ones, then hand off
    with the message from **5. Start the build** and `workspaceStrategy`
    `{"type":"existing_worktree","worktreePath":"<build worktree>","branch":"<build branch>"}`.
    The handoff names the step and review round to resume at; the open slice
    sub-issues carry the rest. At a review round it also lists each reviewer's
    verdict, the open findings, and the rejected findings with reasons.
- Never merge or push to `main`. Commit and PR rules are in each repo's
  `AGENTS.md`.

## Grilling with docs

Wherever this skill grills (open questions in **2. Size up**,
[Concepts](concepts.md) step 1, `decision: grill`), load `grilling` and
`domain-modeling`, as upstream `grill-with-docs` does. Challenge Pedro's terms
against the repo's `GLOSSARY.md` and ADRs; capture each resolved term and
ADR-worthy decision the moment it settles.

Shaping, concept and decision threads run in the repo's main checkout with no
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
- A `decision: *` sub-issue: [Decisions](concepts.md#decisions).
- A `build` sub-issue, or a passing brief in the body: **5. Start the build**,
  launch check included, also when resuming a shaping handoff.
- Anything else: set Shaping. An **Explore subagent** reads the repo's
  `AGENTS.md`, `GLOSSARY.md`, relevant ADRs and the code this issue touches,
  and returns ≤300 words in `domain-modeling` vocabulary: what exists, where,
  and what the issue would change.

## 2. Size up

Pick the route yourself; never ask Pedro to pick one by name. Ask him to
confirm it ([question UI](questions.md)) in a few lines: what you understood
the item to be; the repositories that change; the open questions, or "none";
and what happens next in plain
words ("I'll ask you three questions, then write the brief"; "a subagent
reproduces the bug first; I only ask you if the expected behaviour is
unclear"; "this is too big for one session, so I'll turn it into a concept
map").

Add the kind label (`bug`, `feature`, `improvement`, `concept`), first running
[label setup](issue-tracker.md#label-setup) in the issue's repo if it lacks the
label. Anything Pedro adds or corrects is another open question. Then:

- **Bug**: first a **Diagnose subagent** with `diagnosing-bugs` returns the
  cause, the evidence and a failing test to write; its open questions join the
  list.
- **Open questions**: settle every one here by **Grilling with docs**, for bugs
  and features alike. A question of how something looks or feels gets a
  **Prototype** child task with `prototype`, started per
  [Orchestration](orchestration.md): two or three variants differing only on
  that question. It keeps its screenshots in its own context and returns each
  variant's file paths and a short description. Tell Pedro how to open them
  (T3 browser preview for web; the run scripts in the repo's T3 project for
  Apple), ask for his pick, and record it and the branch on the issue.
- **Another repository changes**: that work becomes a build there, a
  sub-issue of this issue that blocks it (reuse an open issue that covers it),
  with its own brief and gate. This issue is a build only if its own repository
  changes.
- **No open questions**: write the brief.
- **Too big or unclear for one session**: [Concepts](concepts.md). Repository
  count never makes an issue a concept.

## 3. Brief

Replace the issue body with the brief; Pedro's original text goes in a
collapsed `<details>` block at the end.

```markdown
## What
<the change, in Pedro's domain language>

## Done when
- <observable result a reviewer can check>

## Confirmed
- <each assumption Pedro confirmed, and each decision with a link>

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
2. In one batch, ask Pedro every assumption he hasn't confirmed and every
   Doubt finding you can't fix.
3. Set **Ready**.

## 5. Start the build

Every build starts at once; blocked-by orders merges, not work. The builds:
this issue if it's a build, each `build` sub-issue, and other-repo builds found
while shaping, all Ready.

1. **Launch check.** Before any `t3_thread_launch`, list each build and wait
   for Go:
   - `owner/repo#n`, title and a one-line What;
   - its T3 project (`t3_project_list`). With none, "clone needed" if Pedro
     can push (`gh repo view <owner/repo> --json viewerPermission` is ADMIN,
     MAINTAIN or WRITE), else "no push access, needs your OK";
   - branch `<kind>/<n>-<slug>` (`fix`, `feat` or `chore`) from `main`;
   - the merge order, when one build blocks another.

   Ask it as an ordinary [question](questions.md) ("Go (Recommended)" /
   "Adjust") on the issue whose thread launches, then set it back to Ready
   (Shaping for a map or decision). The list goes in the question, or in chat
   just before it if too long. On Adjust, update the briefs, rerun the
   **4. Gate** Doubt where What or Done when changed, and ask again. Only
   shaping and decision threads run the check, and never for a handoff thread.
2. After Go, for each build:
   1. With no T3 project, clone and register its repo (`t3_project_clone`,
      then `t3_project_create`) and run
      [label setup](issue-tracker.md#label-setup) there.
   2. Add the `build` label
      (`gh issue edit <n> --repo <owner/repo> --add-label build`), so the
      board shows its sub-issues as slices.
   3. Launch its build thread with `t3_thread_launch` in that project:
      - `workspaceStrategy`: `{"type":"worktree","baseRef":"main","branch":"<kind>/<n>-<slug>","startFromOrigin":true}`;
      - `message`: `Build <owner/repo#n>. Read <this skill>/agents/builder.md and follow it.`
        with this skill's absolute path.

Set a parent that isn't a build to In progress; it stays there until a
build's PR closes it ([Parent closing](issue-tracker.md#parent-closing)). Give Pedro each build
thread's link. This shaping thread is done.
