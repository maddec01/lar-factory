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
  in **subagents** that return a short summary, so this thread never holds whole
  files. Ask Pedro only what a subagent can't answer.
- Whenever the item waits on Pedro, set it to **Needs you** and send one push
  notification (`PushNotification`) naming the issue and what you need. Set it
  back to Shaping when he answers.
- The issue is the only hand-over. Each step must be resumable from the issue
  alone: the brief, the map, decisions and links live in its body and comments.
- If this thread passes about 150k tokens, write a handoff following
  `~/.agents/skills/handoff/SKILL.md`, post it as an issue comment, and continue
  with `/mux-work <issue>` in a fresh thread (`t3_thread_launch`, root workspace).
- Never merge, never push to `main`. Commit and PR rules are in each repo's
  `AGENTS.md`.

## 1. Pick up

Read the issue with comments, parent, sub-issues and blockers. Then:

- A `decision: *` sub-issue: go to **Decisions** below.
- A `build` sub-issue, or any issue whose body already has a passing brief: go
  to **5. Start the build**.
- Anything else: set Shaping and start an **Explore subagent**: read the repo's
  `AGENTS.md`, `GLOSSARY.md`, relevant ADRs and the code this issue touches;
  return at most 300 words on what exists, where, and what the issue would
  change. Use `domain-modeling` vocabulary.

## 2. Size up

Propose a route in two or three lines, with the kind label (`bug`, `feature`,
`improvement`, `concept`), and wait for Pedro to confirm:

- **Clear**: a bug that can be reproduced, or a small, defined change.
  For a bug, start a **Diagnose subagent** with the `diagnosing-bugs` skill. It
  returns the cause, the evidence and a failing test to write. Ask Pedro only if
  the expected behaviour is unclear.
- **Needs decisions**: open questions that fit one session. Use `grilling` here
  in this thread. When a question is about how something looks or feels, start
  a **Prototype subagent** with the `prototype` skill in its own worktree on a
  `prototype/<n>-<slug>` branch: two or three variants that differ only on that
  question. Set Needs you, tell Pedro how to open them (T3 browser preview for
  web, the repo's simulator run scripts in `t3.json` for Apple), and record his
  pick and the branch on the issue.
- **Foggy**: too big or unclear for one session. Go to **Concepts**.

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

## Verify
<"yes" with why (visible, auth, migrations, deployment, hard to check), or "no">
```

## 4. Gate

1. Any assumption Pedro hasn't confirmed goes back to him (Needs you).
2. Start a **Doubt subagent** with the `doubt-driven-development` skill. Give it
   only the brief and the repo path, no conversation. It tries to show the brief
   is wrong, ambiguous or incomplete. Fix what it finds, or ask Pedro.
3. Set **Ready**.

## 5. Start the build

Start a new T3 thread for the build with `t3_thread_launch`:

- `workspaceStrategy`: `{"type":"worktree","baseRef":"main","branch":"<kind>/<n>-<slug>","startFromOrigin":true}`
  in the issue's repo project, where `<kind>` is `fix`, `feat` or `chore`;
- `message`: `Build <owner/repo#n>. Read <this skill>/agents/builder.md and follow it.`
  with the absolute path of this skill.

Tell Pedro the build thread's link. This shaping thread is done.

## Concepts

The issue becomes the **map** and gets the `concept` label. Its body:

```markdown
## Destination
<what is true when this is done>

## Decisions so far
- <gist> (#n)

## Fog
- <what we don't know yet, and can't phrase as a question yet>

## Out of scope
- <what this won't do>

## Map
<Mermaid flowchart of the sub-issues: decisions and builds, edges for
blocked-by, closed ones styled done. Redraw it whenever a sub-issue changes.>
```

1. Grill Pedro only on the destination and the out-of-scope list.
2. Create a sub-issue for each decision you can phrase now, labelled
   `decision: grill`, `decision: prototype`, `decision: research` or
   `decision: task`, linked with blocked-by where one needs another
   (`docs/agents/issue-tracker.md` in the repo shows the commands). Put them in
   Queued. Leave the rest in Fog.
3. For `decision: research`, start the research now with the `research` skill in
   the background. Findings go on a `research/<n>-<slug>` branch; link it from
   the sub-issue.
4. Set the map to Shaping while decisions are open. Each decision runs in its own
   thread with `/mux-work <sub-issue>`.

### Decisions

Work one decision sub-issue with the method its label names (grilling,
prototype, research findings, or a small task). Then comment the answer, close
it, add its gist to the map's Decisions so far, and redraw the map. Turn fog
that became clear into new decision sub-issues. When a part of the destination
is fully decided, create a `build` sub-issue for it with a brief (**3. Brief**),
run the gate, set it Ready, and start its build (**5**). The map is done when
the fog is gone and every build has merged.
