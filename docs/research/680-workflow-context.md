# Factory workflow context in any repository

Research for [#680](https://github.com/maddec01/lar-factory/issues/680), part of the #653 map.
It feeds the grill in [#681](https://github.com/maddec01/lar-factory/issues/681).

Sources read on 2026-10-30:

- Claude Code docs: [memory](https://code.claude.com/docs/en/memory) (CLAUDE.md and AGENTS.md),
  [skills](https://code.claude.com/docs/en/skills), [settings](https://code.claude.com/docs/en/settings),
  [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript).
- Codex docs: [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and
  [skills](https://learn.chatgpt.com/docs/build-skills) (the `developers.openai.com/codex/...`
  pages now redirect there).
- T3 Code: `pingdotgg/t3code` at
  [`9b1d351`](https://github.com/pingdotgg/t3code/tree/9b1d351ba0f63f527f884ffb3f2e394f50388764) (main),
  and the installed `t3 thread start --help`.
- VanEck IApp (`VanEckEurope/VanEckDirect/IApp`), default branch `master` at commit `6bc2064`,
  read through `az devops invoke --area git --resource items`. Nothing was written to it.
- This repository at `origin/main` (`571b9f7`), and the earlier research in
  `docs/research/594-agent-skill-folders.md` (branch `research/594-agent-skill-folders`) and
  `docs/research/353-matt-pocock-setup.md` (branch `research/353-matt-pocock-setup`).

## Summary

- Neither agent can load a project's `AGENTS.md` while skipping its project skills through one
  switch. Both load instructions and skills from separate places with separate controls, and the
  controls for skills work by skill name (Claude) or by absolute `SKILL.md` path (Codex). No
  control says "hide every skill of this repository".
- The board's only per-thread lever is the message. `t3 thread start` takes a project, a message,
  a title, a provider instance, a model and a worktree. It has no flag for a system prompt or
  settings. Instance launch arguments apply to every thread on that instance.
- Lar's own skills already carry their workflow in their own files (`skills/shared/issue-tracker/`).
  They read the project's files in four places, and three of those pull in workflow rules as well
  as coding rules.
- IApp's setup clashes with the factory in the `## Agent skills` block, all three `docs/agents/`
  files, and its two auto-invoked project skills. Its `CLAUDE.md` also stops Claude Code from
  loading `AGENTS.md` at all, so a Claude thread there starts without IApp's coding rules.
- Recommendation: a lar rule in `lar-shape` and `lar-build`, passed into every subagent brief,
  that splits a repository's files into coding rules (follow) and workflow (ignore), plus one new
  Override for the `code-review` Copy's setup line. No file in the repository, tracked or not.

## 1. How the agents load instructions and skills

### Claude Code

**Instruction files.** Claude Code reads `./CLAUDE.md` or `./.claude/CLAUDE.md` from the working
directory and every directory above it, plus `~/.claude/CLAUDE.md` (memory, "How CLAUDE.md files
load"). It reads `AGENTS.md` natively since v2.1.277, but by default only when no `CLAUDE.md`,
`.claude/CLAUDE.md` or `CLAUDE.local.md` sits in the working directory or above it (memory,
"When Claude Code reads AGENTS.md"). The `instructionFiles` option of the built-in
`cc-plugin-agents-md@builtin` plugin changes that: `claude-md-and-agents-md` loads both. Claude
Code reads that option only from `~/.claude/settings.json`, a `--settings` file or managed
settings, never from project or local settings (memory, "Choose which instruction files load").
`@path` imports pull other files in; a plain Markdown link does not (memory, "Import additional
files"). `claudeMdExcludes` skips named instruction files by glob, at any settings layer
(memory, "Exclude specific CLAUDE.md files").

**Skills.** Project skills load from `.claude/skills/` in the starting directory and each parent
up to the repository root, and from a subdirectory's `.claude/skills/` once Claude touches a file
there (skills, "Load skills in monorepos and subdirectories"). Claude Code does not read
`.agents/skills`. When names clash, personal beats project (skills, "Resolve skills that share a
name"). A skill can be hidden by:

- `disable-model-invocation: true` in its own frontmatter, which stops Claude invoking it while
  `/name` still works (skills, "Control who invokes a skill");
- `skillOverrides` in settings, keyed by skill name, with `"off"` hiding it from Claude and the
  `/` menu. The `/skills` menu saves it to `.claude/settings.local.json` (skills, "Override skill
  visibility from settings");
- a `Skill(<name>)` deny rule, or denying `Skill` outright, which also blocks lar's own skills
  (skills, "Restrict Claude's skill access").

**Local settings in a worktree.** In a git worktree Claude Code reads and writes
`.claude/settings.local.json` at the main checkout's root, and adds it to the global git excludes
when it first writes the file (settings, "Where Claude Code keeps the local file in a git
repository" and "Keep personal settings out of a repository"). A local `skillOverrides` written
for a factory worktree therefore also applies to the user's own sessions in that repository.

**What T3 passes.** T3's Claude adapter keeps the `claude_code` system prompt preset and appends
its runtime instructions plus any `--append-system-prompt` from the instance's launch arguments
(`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:1579-1591`, `:1490-1497`). It sets
no `settingSources` for the session, so the SDK default applies, "CLI defaults (all sources)"
(Agent SDK reference, `settingSources`). Project settings, project skills and `CLAUDE.md` all load.

### Codex

**Instruction files.** Codex reads `~/.codex/AGENTS.override.md` or `AGENTS.md` globally, then
walks from the project root down to the working directory and takes at most one file per
directory: `AGENTS.override.md`, else `AGENTS.md`, else a name from
`project_doc_fallback_filenames`. The combined text stops at `project_doc_max_bytes` (32 KiB by
default) (AGENTS.md doc, "How Codex discovers guidance"). An `AGENTS.override.md` replaces the
directory's `AGENTS.md` rather than adding to it. The doc names no switch that turns project
`AGENTS.md` off. Codex ignores `CLAUDE.md` unless it is listed as a fallback name.

**Skills.** Codex scans `.agents/skills` in every directory from the working directory up to the
repository root, then `$HOME/.agents/skills`, `/etc/codex/skills` and its bundled skills. Two
skills with one name both appear (skills doc, "Where Codex loads local skills"). A
`[[skills.config]]` entry with an absolute `path` and `enabled = false` in `~/.codex/config.toml`
disables one skill after a restart; `allow_implicit_invocation: false` in a skill's
`agents/openai.yaml` stops only implicit use (skills doc, "Enable or disable local Codex skills").
A factory worktree has a new path for every build, so path entries do not carry over.

**What T3 passes.** T3 sends Codex its own developer instructions
(`apps/server/src/provider/CodexDeveloperInstructions.ts`) and passes the instance's launch
arguments to `codex app-server` (`packages/contracts/src/settings.ts:666-671`). Neither is per thread.

### Can a thread keep `AGENTS.md` and skip the project's skills?

Partly, and only through instructions. Both agents load the project's instruction files and its
skills independently, so keeping one and dropping the other is possible. But the only hard
switches for skills are by name or by path, set in the user's settings or in the repository's
local files, and none is per thread. A skill with no `disable-model-invocation` flag stays
available to Claude, and Claude can pick it up from its description. What stops a thread from
using it is a rule in the thread's own context.

## 2. The options

### A. A lar rule in lar's own skills, with Overrides for Copies

`lar-shape` and `lar-build` state which parts of a repository's files a thread follows. Each
skill already passes its prose rules into every subagent's brief
(`skills/lar-build/SKILL.md:7-11`), and the same route carries this rule. Where a Copy reads the
repository's workflow setup, an Override in the lar file that loads it sets that part aside and
is listed in `UPSTREAM.md`, as [ADR 0031](../adr/0031-lars-skills-carry-upstream-content-as-ports-or-copies.md)
allows. Ports change directly.

- It works the same in Claude and Codex, in any repository, and writes nothing to the repository.
- It ships with each Release, so every machine with the skills gets it.
- It is an instruction, not a switch. A project skill with a matching description can still be
  picked up if the rule is weak or lost. Briefs carry it only if each step passes it on.
- The `code-review` Copy's setup line sits above its first heading
  (`skills/lar-build/skills/code-review/SKILL.md:13`), and the "Overridden in" format names a
  `#heading`. The Override needs a way to cite a heading-less preamble.

### B. The thread prompt the board sends

The work message is `#<n> <title>` then `$lar-shape <repo>#<n>`
(`packages/shared/src/model.ts:725-729`), and the build message tells the thread to read
`builder.md` (`model.ts:744-747`). The board could add the rule to both.

- It needs no skill change, and the board can tailor it per repository, for example by naming
  the project skills it found.
- It reaches only the first agent. Subagents, handoffs and resumed threads see what the skills
  pass on, so the rule would still have to live in the skills.
- A thread the user starts by hand with `/lar-shape` gets nothing.
- T3 offers no per-thread system prompt (`t3 thread start --help`), so the text sits in the first
  user message, which is where the skill invocation already is.

### C. An untracked file in the checkout

A file kept out of git through `.git/info/exclude` or the global excludes.

- `AGENTS.override.md` makes Codex skip the repository's `AGENTS.md` in that directory, so the
  coding rules are lost unless the file copies them, and then it goes stale.
- `CLAUDE.local.md` counts as a `CLAUDE.md`, so in a repository that has only `AGENTS.md` it stops
  Claude Code from reading `AGENTS.md` (memory, "When Claude Code reads AGENTS.md").
- `.claude/settings.local.json` with `skillOverrides` hides named project skills from Claude,
  cleanly. But it lives at the main checkout's root, so it also hides them from the user's own
  sessions, it does nothing for Codex, and the board would have to write and maintain it per
  repository and per skill name.
- Untracked files exist per worktree. Each factory worktree needs the file again, and T3's
  worktree setup would have to write it.
- Codex's `[[skills.config]]` lives in `~/.codex/config.toml`, not the checkout, and needs each
  worktree's absolute path.

### D. Instance-level settings in T3

A dedicated T3 provider instance for factory threads, whose launch arguments carry
`--settings` (Claude) or `-c` overrides (Codex). `--settings` can set
`cc-plugin-agents-md@builtin`'s `instructionFiles` and `skillOverrides`, which project files
cannot. It is per instance, not per thread or per repository, and the user's own T3 setup would
have to change. It can back up option A for Claude but not replace it.

## 3. VanEck IApp

### What its files hold

- `AGENTS.md` (67 lines): coding rules in "Known breakage", "Where code goes", "Running things",
  "Definition of done" and "Conventions" (lines 1-52), then an `## Agent skills` block
  (lines 54-66). The block says `/to-spec` updates the developer's current story and `/to-tickets`
  creates Tasks under it, labels are "Default five role names, applied as Azure Boards tags", and
  domain doc changes "go on a `docs/<id>-<slug>` branch and PR, never on master or a story branch".
- `CLAUDE.md` (24 lines) says "Use [`AGENTS.md`](./AGENTS.md) as the canonical repo guide" through
  a Markdown link, not an `@` import. It lists two committed project skills and says Matt Pocock's
  skills are user-level, installed per machine with `npx skills@latest add mattpocock/skills`.
- `docs/agents/issue-tracker.md` (134 lines): "Workflow: one story at a time". Agents write only
  the current story's Description and Acceptance Criteria and its child Tasks, never create
  Features, Product Backlog Items or Bugs, and never change the story's tags, state or assignee.
  Three stages run in fresh sessions. Implementation runs on `feature/<id>-<slug>`, task branches
  fast-forward onto it, and the story branch stays local until every Task is done, then gets one
  PR. New Tasks get the `ready-for-agent` tag.
- `docs/agents/triage-labels.md`: Matt Pocock's five roles as tags, unchanged.
- `docs/agents/domain.md`: Matt Pocock's template plus "Where domain changes go": a separate
  `docs/<story id>-<slug>` branch and PR for `GLOSSARY.md` and ADR changes.
- `.claude/skills/build-feature` and `.claude/skills/refactor-review`: no
  `disable-model-invocation`. Their descriptions say "Use when implementing a feature, adding new
  code…" and "Use when asked to review code … or before opening a PR". Both are mostly coding
  rules (the locked stack, exemplars, drift from the React refactor) packaged as a process.
- No `.agents/skills`, so Codex sees neither project skill.

The Repository config shows IApp's onboarding at step `pr`
(`bash skills/shared/scripts/repo-config.sh --list`), and `master` still holds Matt Pocock's setup,
so the onboarding PR has not merged.

### Where it clashes with the factory

| IApp rule | Factory rule | Effect in a factory thread |
| --- | --- | --- |
| `## Agent skills` names `/to-spec`, `/to-tickets` | `lar-shape` shapes, `lar-build` builds | A second answer to "which skill runs this step". |
| Agents never change a story's tags or state | Status as `status-*` tags and kind tags on the work item (`skills/shared/issue-tracker/status.md`), Azure State moves (ADR 0024) | Every factory status write breaks IApp's rule. #653 moves status off the provider, which removes most of this. |
| Agents create only Tasks under the current story | Concepts and decisions are work items; slices are child Tasks (`azure-devops.md`) | Refinement's published concept clashes; slices agree. |
| `feature/<id>-<slug>`, task branches fast-forwarded, one push at the end | Build branch `feat/<n>-<slug>` (`model.ts:737`), slices merged into it (ADR 0004), builder pushes and opens the PR | Branch names and push timing differ. |
| New Tasks tagged `ready-for-agent`; five triage tags | `active` and `blocked` tags on slices | Two tag vocabularies on the same Tasks. |
| Domain docs on their own `docs/` branch and PR | The build PR writes the brief's Domain docs (`agents/builder.md` step 5) | The builder follows `docs/agents/domain.md` for links, so it may also follow the branch rule. |
| A fresh session per stage | One thread per item, shaping then build | Agents told to stop and "start a new session". |
| Auto-invoked `build-feature`, `refactor-review` | `implementer.md`, `reviewer-code.md` | A Claude implementer or reviewer can load the project skill in place of, or beside, lar's step. |
| `CLAUDE.md` present, `AGENTS.md` only linked | lar agents read `AGENTS.md` by name | In Claude, IApp's coding rules are not in context at start; they arrive only where a lar step reads `AGENTS.md` itself. |

Matt Pocock's skills on this machine are user-level (`~/.agents/skills`, linked into
`~/.claude/skills` and `~/.claude-personal/skills`) and every one of them except `find-skills`
sets `disable-model-invocation: true`. Claude won't invoke them on its own, even when `AGENTS.md`
names them. Whether Codex honours that Claude frontmatter key was not checked; Codex's own doc
names only `allow_implicit_invocation` in `agents/openai.yaml`.

## 4. Which Copies and Ports read `AGENTS.md` or `docs/agents/`

| File | Kind | What it reads | Workflow risk |
| --- | --- | --- | --- |
| `skills/lar-build/skills/code-review/SKILL.md:13` | Copy | "The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`." | In a repository with no setup, the reviewer may stop and ask for Matt Pocock's setup. No Override covers this line today. |
| `code-review/SKILL.md:29` ("2. Identify the spec source") | Copy | Fetches issues "via the workflow in the tracker doc" | Already overridden in `agents/reviewer-code.md` (the brief is the spec, through `gh issue view`, which fails on Azure DevOps). |
| `code-review/SKILL.md` "3. Identify the standards sources" | Copy | Every file documenting coding standards | Wanted: this is how IApp's coding rules and its `refactor-review` packs reach the review. |
| `skills/lar-build/agents/builder.md:110-114` | lar | Links domain docs "as the repo's `docs/agents/domain.md` says", else adds a **Domain docs** section to `AGENTS.md` | In repository (a) it edits `AGENTS.md`, a tracked write. In IApp it can pick up the separate-branch rule. |
| `skills/shared/issue-tracker/*.md:8` (all seven files) | lar | "Read the destination's `AGENTS.md` and issue conventions before writing." | In IApp this points at `docs/agents/issue-tracker.md`, whose rules forbid most factory writes. |
| `lar-shape/pick-up.md:15`, `agents/doubt.md`, `implementer.md`, `ci-fixer.md`, `approver.md`, `reviewer-*.md` | lar and Ports | `AGENTS.md` for checks, commit rules, threat context and standards | Wanted: these are coding rules. |
| `skills/lar-build/plan-slices.md:42` | Port of `to-tickets` | Nothing; it says "Do not … configure a tracker or apply ready-for-agent" | Already fixed in the Port. |

The board's code assumes [ADR 0022](../adr/0022-onboarding-writes-the-factorys-agent-setup-and-lands-cleanup-through-a-pr.md):
`apps/server/src/onboarding/agent-setup.ts` holds the `## Agent skills` block and the three
`docs/agents/` files the onboarding PR writes (`pr-changes.ts:111`); `clash-runs.ts:82-94` asks an
agent to find Clashes and skips the block and `docs/agents/`; `config/repository-config.ts:345-365`
reads `AGENTS.md`, `CLAUDE.md` and `docs/agents/` on each refresh and reports retired skill names;
`reset-pr.ts` removes them again. ADR 0022's reason for writing the files was the `to-tickets` and
`code-review` Copies. `to-tickets` is now a Port (`plan-slices.md`), so only the `code-review`
line at `SKILL.md:13` still needs the setup.

## Recommendation

Option A: a lar rule, carried by lar's skills, with one new Override.

1. `lar-shape/SKILL.md` and `lar-build/SKILL.md` add a short rule beside the prose rules and pass
   it into every subagent's brief by path, the same way. It says: from the repository's
   `AGENTS.md`, `CLAUDE.md` and the docs they point to, follow the coding rules (structure,
   commands, checks, conventions, definition of done, commit format). Ignore its workflow: the
   `## Agent skills` block, `docs/agents/`, ticket, label, branch and session rules, and don't
   invoke the repository's own skills or ones it names. Read both `AGENTS.md` and `CLAUDE.md`
   even when the agent loaded only one.
2. `agents/reviewer-code.md` adds an Override for the `code-review` Copy's preamble line: the
   tracker is the issue's provider, per `shared/issue-tracker/`. `UPSTREAM.md` gains a way to cite
   a preamble, for example `SKILL.md#(preamble)`. The same Override can make "2. Identify the spec
   source" use `az` on Azure DevOps.
3. `shared/issue-tracker/*.md` line 8 narrows "Read the destination's `AGENTS.md` and issue
   conventions" to its commit and PR rules. `builder.md` step 5 stops reading `docs/agents/domain.md`
   and links domain docs from `AGENTS.md` only where the repository already does; #679 decides
   where domain docs go when the factory may not write to the repository.

Reasons:

- It is the only option that reaches subagents, handoffs and threads started by hand, because the
  skills are what every one of them loads. The board's message (option B) reaches only the first
  agent.
- It works in Claude and Codex alike and needs no file in the repository. An untracked file
  (option C) either drops the coding rules (`AGENTS.override.md`, `CLAUDE.local.md`) or covers
  only Claude and leaks into the user's own sessions (`settings.local.json`).
- It meets #653's "Onboarding a repository the user doesn't own writes nothing to it" and lets
  #681 retire ADR 0022's agent setup. With the `code-review` preamble overridden, no bundled Copy
  needs `docs/agents/` any more.
- It keeps IApp's useful parts. IApp's coding rules stay in force, and `code-review`'s step 3
  still reads `refactor-review`'s packs as a standards source.

The rule is an instruction, not a switch, so a Claude thread can still pick up an auto-invoked
project skill such as `build-feature` if the rule is lost. If that shows up in practice, a T3
instance for factory threads whose launch arguments pass `--settings` with `skillOverrides`
(option D) is a Claude-only backstop. It needs each skill's name, so it suits a few known
repositories, not every repository.

## Open questions for #681

- Where the line falls for a project skill that is mostly coding rules, such as IApp's
  `build-feature`: ignore it, or let the implementer read it as a standards source the way
  `code-review` step 3 reads `refactor-review`.
- What wins when a repository's commit or PR rules (IApp: one story PR with `--work-items`)
  conflict with the factory's build PR.
- Whether the factory checks, at Start, for project skills without `disable-model-invocation` and
  names them in the work message (option B as a supplement).
- Unconfirmed: whether Codex honours `disable-model-invocation` in a user-level skill.
