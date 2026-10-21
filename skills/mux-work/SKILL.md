---
name: mux-work
description: Take a queued Mux issue from shaping to a brief, then start its build. Use when the user runs /mux-work with an issue.
argument-hint: "<owner/repo#n or issue URL>"
disable-model-invocation: true
---

You run one item of the Mux factory. Pedro answers questions, picks prototypes,
verifies visible changes and merges every PR. Everything else is yours.

## Rules

- Move the issue's Status on the "Mux" board at every step with
  `bash <this skill>/scripts/status.sh <owner/repo#n> "<Status>"`. Statuses:
  List, Queued, Shaping, Needs you, Ready, In progress, Review, Verify,
  Ready to merge, Done.
- Facts are yours to find, decisions are Pedro's. Read code, docs and history
  in **subagents**, so no thread holds whole files. Every factory subagent
  report is ≤300 words and never pastes whole files, logs or screenshots. Ask
  Pedro only what a subagent can't answer.
- Every question to Pedro follows the [question UI](questions.md).
- The issue is the only hand-over. Each step must be resumable from the issue
  alone: the brief, the map, decisions and links live in its body and comments.
- Past about 150k tokens, a thread hands off: write a handoff following
  `~/.agents/skills/handoff/SKILL.md`, post it as an issue comment, and continue
  in a fresh thread with `t3_thread_launch`.
  - Shaping thread: `/mux-work <issue>`, root workspace.
  - Build thread: only while work before the PR step remains (slices, merges, a
    review round); otherwise finish in place (PR, status, retro). Past the
    mark, start no new implementers; merge the running ones, then hand off.
    Launch with
    the message from **5. Start the build** and `workspaceStrategy`
    `{"type":"existing_worktree","worktreePath":"<build worktree>","branch":"<build branch>"}`.
    The handoff names the step and review round to resume at; the open slice
    sub-issues carry the remaining state. At a review round it also lists each
    reviewer's verdict, the open findings and the rejected findings with
    reasons.
- Never merge, never push to `main`. Commit and PR rules are in each repo's
  `AGENTS.md`.

## Grilling with docs

Wherever this skill grills (open questions in **2. Size up**,
[Concepts](concepts.md) step 1, `decision: grill`), load `grilling` and
`domain-modeling`, the pair upstream `grill-with-docs` loads. Challenge Pedro's terms against the repo's
`GLOSSARY.md` and ADRs, and capture each resolved term and ADR-worthy decision
the moment it settles, as `domain-modeling` says.

Shaping, concept and decision threads run in the repo's main checkout, with no
branch and no PR, so they write only to the issue and leave the checkout as
they found it. Where `domain-modeling` says to update `GLOSSARY.md` inline or
write an ADR, draft the entry instead: capture it as it settles, record it in
the batch's answers comment, then put it in the **Domain docs** section of the
brief (**3. Brief**) or the map ([Concepts](concepts.md)). Drafts follow `domain-modeling`'s `GLOSSARY-FORMAT.md`
and `ADR-FORMAT.md`, and an ADR draft meets its three conditions. The builder
writes them to the repo in the build PR.

## 1. Pick up

Read the issue with comments, parent, sub-issues and blockers. Then:

- **Unfinished retro capture record**: before any route below, including a
  passing brief, follow [Retro capture](retro-capture.md) to finish only the
  pending capture. Preserve the source status; do not rerun its build or retro,
  start shaping, or launch another thread. Report links and pending failures,
  then end this pickup, even if capture completes.
- A `decision: *` sub-issue: go to [Decisions](concepts.md#decisions).
- A `build` sub-issue, or any issue whose body already has a passing brief: go
  to **5. Start the build**.
- Anything else: set Shaping and start an **Explore subagent**: read the repo's
  `AGENTS.md`, `GLOSSARY.md`, relevant ADRs and the code this issue touches;
  return at most 300 words on what exists, where, and what the issue would
  change. Use `domain-modeling` vocabulary.

## 2. Size up

Decide the route yourself. Never ask Pedro to pick a route by name. Ask him to
confirm it ([question UI](questions.md)), in a few lines:

- what you understood the item to be;
- the open questions you found, or "none";
- what happens next, in plain words. For example: "I'll ask you three
  questions, then write the brief", or "a subagent reproduces the bug first; I
  only ask you if the expected behaviour is unclear", or "this is too big for
  one session, so I'll turn it into a concept map".

Add the kind label (`bug`, `feature`, `improvement`, `concept`). Pedro confirms
or corrects; anything he adds is another open question. Before applying a missing
label, run [label setup](issue-tracker.md#label-setup) in the issue's repository.
Then:

- **Bug**: first start a **Diagnose subagent** with the `diagnosing-bugs` skill.
  It returns the cause, the evidence and a failing test to write. Its open
  questions join the list.
- **Open questions**: settle every one here in this thread by **Grilling
  with docs**, through the question UI, for bugs and features alike. When a
  question is about how something looks or feels, start a **Prototype subagent** with the `prototype` skill in its own
  worktree on a `prototype/<n>-<slug>` branch: two or three variants that differ
  only on that question. Tell Pedro how to open them (T3 browser preview for
  web, the run scripts in the repo's T3 project for Apple), ask for his pick
  through the question UI, and record it and the branch on the issue.
- **No open questions**: go straight to the brief.
- **Too big or unclear for one session**: go to [Concepts](concepts.md).

## 3. Brief

Replace the issue body with the brief. Keep Pedro's original text under a
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

1. Start a **Doubt subagent** with the `doubt-driven-development` skill. Give it
   only the brief and the repo path, no conversation. It tries to show the brief
   is wrong, ambiguous or incomplete, and that its **Domain docs** agree with
   the repo's `GLOSSARY.md` and ADRs, with every ADR draft meeting
   `domain-modeling`'s three conditions. Fix what it finds.
2. Ask Pedro, in one batch, every assumption he hasn't confirmed and every
   Doubt finding you can't fix yourself.
3. Set **Ready**.

## 5. Start the build

Start a new T3 thread for the build with `t3_thread_launch`:

- `workspaceStrategy`: `{"type":"worktree","baseRef":"main","branch":"<kind>/<n>-<slug>","startFromOrigin":true}`
  in the issue's repo project, where `<kind>` is `fix`, `feat` or `chore`;
- `message`: `Build <owner/repo#n>. Read <this skill>/agents/builder.md and follow it.`
  with the absolute path of this skill.

Tell Pedro the build thread's link. This shaping thread is done.
