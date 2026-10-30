# Factory workflow context in any repository

Research for [#680](https://github.com/maddec01/lar-factory/issues/680), under [#653](https://github.com/maddec01/lar-factory/issues/653), read with all comments on 2026-10-30. This is evidence and a recommendation for #681, not an implementation or an approved decision. No ticket writes were made.

## Recommendation

Use the factory thread's initial prompt to select lar's workflow and supply the item source, brief location, domain-doc location and provider-write policy. Keep reusable defaults in lar's own skills. Add narrow Overrides beside each remaining Copy load where its assumptions require repository workflow files. Retain project coding rules, architecture, security requirements, setup and checks. Explicitly set aside competing workflow routing, tracker writes, stage sessions and domain-doc publication rules for factory work.

This is a behavioral instruction, not proof that project skills are absent from the provider's context. If strict exclusion is required, add provider-specific skill controls after verifying the installed version and T3 launch support. Do not claim a universal project-skills-off switch. A project skill can contain useful coding rules too, so classify by content rather than discarding every skill in the repository.

This recommendation follows the user's direction in #653 and the existing distinction between Copies, Ports and Overrides in [AGENTS.md](../../AGENTS.md), [the glossary](../../GLOSSARY.md) and [ADR 0031](../adr/0031-lars-skills-carry-upstream-content-as-ports-or-copies.md). It would replace the mandatory repository setup approach in [ADR 0022](../adr/0022-onboarding-writes-the-factorys-agent-setup-and-lands-cleanup-through-a-pr.md). That ADR must be superseded explicitly in a later build.

## Provider loading facts

Claude Code loads project and ancestor CLAUDE.md files, with nested instructions loaded when relevant files are read. Current official documentation also describes native AGENTS.md support, conditional on version and the instruction-files setting. By default a project CLAUDE.md or CLAUDE.local.md suppresses the AGENTS.md fallback; a setting can load both. Older versions need an import. Therefore adding CLAUDE.local.md can accidentally remove coding rules. Check the actual installed provider rather than assuming all Claude instances behave alike. See [Claude memory](https://code.claude.com/docs/en/memory#agentsmd).

Claude discovers personal, project and plugin skills and normally exposes descriptions before loading their bodies on invocation. `disable-model-invocation` prevents automatic invocation. Current `skillOverrides` can hide individual local skills without modifying their files; plugin skills need plugin controls. Denying the Skill tool blocks invocation but is not a selective project-origin filter. These controls are distinct from instruction-file loading. See [Claude skills](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings).

Codex builds instructions from global guidance and the repository-root-to-working-directory chain. At each directory AGENTS.override.md takes precedence over AGENTS.md; configured fallback names follow. An override at the same root can consequently replace coding rules unless it includes them. CLAUDE.md is not a default Codex instruction filename. See [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Codex discovers repository skills in ancestor `.agents/skills` directories through the repository root, plus user, admin and system locations. Same-name skills are not merged. Its documented `skills.config` entries disable individual paths without deleting files; restart after changing user configuration. This does not remove AGENTS.md instructions. Neither official page establishes a single portable per-thread switch that excludes only project workflow skills. See [Codex skills](https://learn.chatgpt.com/docs/build-skills).

## Options and their limits

| Option | What it solves | Limit |
| --- | --- | --- |
| Lar skill defaults and Overrides | Supplies missing workflow context at the Copy that needs it | Applies when that lar step runs; does not suppress repository discovery |
| Initial thread prompt | Selects factory workflow in repositories with no factory files and names competing workflow sections | Must reach resumed work and delegated roles; behavioral compliance needs validation |
| Ignored local file | Can store per-machine instructions if the provider explicitly loads it | Git ignore rules do not cause instruction loading; provider names and precedence differ; files can leak into ordinary team sessions |

A file in `.git/info/exclude` is only an ignore pattern entry, not a cross-provider instruction mechanism. An arbitrary excluded Markdown file needs an explicit read or prompt reference. A root AGENTS.override.md replaces the root coding instructions in Codex. CLAUDE.local.md has the Claude fallback consequence above. A normal local file also needs provisioning in each worktree and cleanup. Prefer context carried by the thread over these repository mutations. These are deductions from the documented loaders, not results from a live provider experiment.

## IApp's Matt Pocock setup

Verified against the local `/Users/pedrogomes/Developer/VanEck/IApp` checkout, using AGENTS.md and its three docs/agents pointers. Source links are private Azure Repos paths: [AGENTS.md](https://dev.azure.com/VanEckEurope/VanEckDirect/_git/IApp?path=/AGENTS.md), [issue tracker](https://dev.azure.com/VanEckEurope/VanEckDirect/_git/IApp?path=/docs/agents/issue-tracker.md), [domain](https://dev.azure.com/VanEckEurope/VanEckDirect/_git/IApp?path=/docs/agents/domain.md), [triage labels](https://dev.azure.com/VanEckEurope/VanEckDirect/_git/IApp?path=/docs/agents/triage-labels.md). Links identify paths; they do not prove the remote default branch matches the local checkout.

The setup routes /to-spec to the current story, /to-tickets to child Tasks, uses ready-for-agent tags, changes Task state and closes Tasks. It requires separate refinement, ticket and implementation sessions, feature story branches, local integration until the final push, and separate docs branches and PRs for domain changes. These clash with factory-owned sessions, slices, publication choices and #653's approval for every ticket write. Existing project domain knowledge remains relevant; its publication procedure needs a specific exception.

Keep IApp's library ownership, Nx boundaries, React stack, backend layering, known-breakage exclusions, environment setup and affected-project lint/test rules. Its documentation-only exemption also remains a coding-check rule. A prompt saying only “ignore AGENTS.md” would lose these requirements.

## Bundled Copies and remaining dependencies

[UPSTREAM.md](../../UPSTREAM.md) records the current Copies. Searching every bundled Copy and checklist for AGENTS.md, docs/agents and setup-matt found no literal instruction to read those paths. The [code-review Copy](../../skills/lar-build/skills/code-review/SKILL.md) does require a provided tracker and otherwise tells the user to run /setup-matt-pocock-skills. Its “Identify the spec source” follows the tracker doc; “Identify the standards sources” searches all repository coding standards, which can lead to AGENTS.md. Keep that standards search.

The [code reviewer wrapper](../../skills/lar-build/agents/reviewer-code.md) already overrides fixed point, spec source, spawning and aggregation. Its spec override still assumes GitHub, and it does not explicitly cancel the setup fallback. A future Override should supply the source from factory context and say not to run project setup. Record that Override in UPSTREAM.md. Do not edit the Copy.

ADR 0022's claim about a bundled to-tickets Copy is historical. Current UPSTREAM.md lists [plan-slices](../../skills/lar-build/plan-slices.md) as a Port. Other current dependencies are lar-owned steps: pick-up reads AGENTS.md and domain docs, shared tracker files consult destination conventions, and the builder still refers to docs/agents/domain.md. These require changes in lar-owned files for repositories without factory files. Overrides alone cannot replace all of that routing.

## T3 source and verification limits

No existing T3 checkout was found in the searched Developer, Documents/Development and T3 locations. A fresh shallow upstream checkout was read locally at `/tmp/lar-680-t3-source`. The inspected source revision was 9b1d351ba0f63f527f884ffb3f2e394f50388764; this identifies the research snapshot, not a dependency or cross-repository work citation.

[ClaudeAdapterV2.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts) builds the Claude preset system prompt with appended runtime and launch instructions. Its settings resolution includes project and local sources even for custom homes. [CodexAdapterV2.ts](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) constructs thread runtime config and cwd. These are plausible integration points, not evidence that the board can already request project workflow exclusion through public launch options. No live launch, version matrix or isolation experiment was performed. Upstream main may differ from the running app.

Repository discovery used repo-config.sh --list. It listed lar-factory, lar-brand, lar-apple, lar-server and IApp; the lar repositories were found under Developer/lar and IApp under Developer/VanEck. No existing tracked notes or research directory was found, so this note uses docs/research beside the existing docs/adr and docs/agents folders. Installed lar-shape research-question, prose and cross-repository citation instructions were read. The user's explicit instruction to work alone and make no issue writes overrides that step's delegation and issue-link instructions.

Before implementation, validate factory selection on both providers in a repository with no factory files and in IApp. Confirm coding rules survive, competing workflow skills do not run, child roles receive the same context, and no provider writes occur before approval. This research does not establish those runtime outcomes.
