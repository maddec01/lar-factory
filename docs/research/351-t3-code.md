# What T3 Code lets the factory do

Research for [#351](https://github.com/maddec01/mux-factory/issues/351), part of the #70 map.

T3 Code source read at `pingdotgg/t3code` commit
[`5b35402`](https://github.com/pingdotgg/t3code/tree/5b35402623d7d1d88eaa472807272a6c2e78012a)
(main on 2026-10-25). Links below point at that commit. CLI help is from the installed
`t3 v0.1.3-nightly.20261025.3655`. The factory was read at `origin/main` on the same day.

## Summary

- Projects: `t3 project add`, `remove` and `rename` change projects safely, with or without a
  running server. No CLI lists projects; the board's read-only database query stays the way to
  list them, or `t3_project_list` from inside a T3 thread. T3 refuses a second live project on the
  same folder, but nothing stops two projects being checkouts of one repository.
- T3 already works out each project's repository (`repositoryIdentity`: provider, owner, name)
  from its git remote, preferring `upstream` over `origin`. The board reads `origin` only.
- Agent providers: nine drivers. Codex and Claude are on by default; Cursor, Grok, OpenCode,
  Antigravity, Pi and Muse are opt-in; ACP Registry agents are added one by one. T3 installs no
  skills and injects no instruction files. Each agent loads its own.
- Skills: `~/.agents/skills` reaches Codex, Cursor, OpenCode, Grok and Pi. Claude needs each
  Claude home's `skills/` folder, and Antigravity needs two `~/.gemini` folders. Muse is
  unconfirmed.
- Source control: GitHub, Azure DevOps, GitLab, Forgejo, GitCafe and Bitbucket, for pull requests
  only. T3 has no issues, boards, Projects, sprints or work items for any of them. On Azure DevOps
  it has no checks and no comment writes.
- Threads: `t3 thread start`, `send`, `show` and `list`, each with `--json`, plus `--wait` with
  exit codes 0, 1 and 2. They need a running server. Provider health
  (`orchestrator_capabilities`) and everything else is only on T3's MCP server.

## Projects

### What a program can do

| Action | CLI | MCP tool | Database |
| --- | --- | --- | --- |
| List | none (`t3 project` has only `add`, `remove`, `rename`) | `t3_project_list` | `projection_projects`, read-only (what the board does today) |
| Create | `t3 project add <path> [--title]` | `t3_project_create` | never write |
| Remove | `t3 project remove <id or path> [--force]` | `t3_project_delete` (`force`) | never write |
| Rename | `t3 project rename <id or path> <title>` | `t3_project_update` | never write |
| Clone a repository | none | `t3_project_clone`, then `t3_project_create` | none |
| Open in the desktop app, adding it if missing | `t3 app <path>` | none | none |

- `t3 project` lists three subcommands, `add`, `remove` and `rename`
  ([`cli/project.ts#L457`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/project.ts#L457),
  [`#L504`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/project.ts#L504),
  [`#L543`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/project.ts#L543);
  `t3 project -h`). None of them prints JSON.
- The project CLI works with or without a running server. It reads the server address T3
  saved when it started; if that server answers, the CLI sends the change over the server's
  HTTP API. Otherwise it takes ownership of the data folder and writes through T3's own
  `ProjectService` ([`cli/project.ts#L353-L444`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/project.ts#L353-L444)).
  So a program never needs to write T3's database to add a project.
- `t3 project add` refuses a folder that already has a live project: "An active project already
  exists for '<root>'" ([`cli/project.ts#L476-L487`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/project.ts#L476-L487)).
  The server enforces the same rule for every client: "Workspace <root> already belongs to
  project <id>" ([`project/ProjectService.ts#L64-L75`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/project/ProjectService.ts#L64-L75)).
- `t3 project remove` without `--force` refuses a project that has threads, archived ones
  included ([`project/ProjectService.ts#L443-L459`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/project/ProjectService.ts#L443-L459)).
  `--force` deletes the threads first. The folder on disk stays
  ([`mcp/toolkits/project/tools.ts#L82-L86`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/toolkits/project/tools.ts#L82-L86)).
- `t3 app <path>` opens the path in the running desktop app. The app looks for a project at that
  path and adds one titled after the folder when there is none, without creating a missing folder
  ([`web/src/components/desktop/DesktopAppActivationCoordinator.tsx#L44-L66`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/web/src/components/desktop/DesktopAppActivationCoordinator.tsx#L44-L66)).
- `t3 --auto-bootstrap-project-from-cwd` creates a project for the working folder when the
  server starts ([`serverRuntimeStartup.ts#L274-L280`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/serverRuntimeStartup.ts#L274-L280)).
  It is for running a server, not for onboarding.
- Over MCP, `t3_project_create` registers a folder and rejects one already registered. Without a
  `workspaceRoot` it makes a new git repository instead
  ([`mcp/toolkits/project/tools.ts#L66-L76`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/toolkits/project/tools.ts#L66-L76)).
  Project and environment changes need a full-access calling thread or a full-access client
  ([`mcp/McpToolAccess.ts#L184-L197`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/McpToolAccess.ts#L184-L197)).

### How a project maps to a checkout

- A project is one folder, its `workspaceRoot`, plus an id, title, default model, scripts and
  settings ([`contracts/src/project.ts#L151-L167`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/project.ts#L151-L167)).
  T3 stores the path as `path.resolve` of the input with `~` expanded. It doesn't resolve
  symlinks ([`workspace/WorkspacePaths.ts#L137-L142`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/workspace/WorkspacePaths.ts#L137-L142)),
  so `/tmp/x` and `/private/tmp/x` are two different roots to the duplicate check.
- One folder has at most one live project. Nothing stops two projects from being two checkouts
  of the same repository, which is why the board's `repositoryProject` already reports "Several
  T3 projects are checkouts of <repo>".
- Worktrees are not projects. A thread started with `--worktree` runs in a new worktree that
  belongs to the project it started in (`t3 thread start -h`).
- T3 works out each live project's repository itself. The `Project` it returns over MCP carries
  `repositoryIdentity`, with the source control `provider`, `owner`, `name`, `webUrl` and the
  checkout's `rootPath`
  ([`contracts/src/environment.ts#L162-L173`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/environment.ts#L162-L173),
  [`project/ProjectService.ts#L156-L182`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/project/ProjectService.ts#L156-L182)).
  This comes from a cache (`projectEnrichment.getAvailable`) and is not in the database, so it can
  be `null` until T3 has looked. Unconfirmed: how long that takes after a project is added.
- The `projection_projects` table the board reads (`project_id`, `workspace_root`, `deleted_at`)
  is still the table T3's `ProjectStore` uses
  ([`persistence/Migrations/005_Projections.ts#L8-L17`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/persistence/Migrations/005_Projections.ts#L8-L17)).
- A checked-in `t3.json` at the project root sets the project's icon, scripts (such as a
  worktree setup script) and some defaults
  ([`contracts/src/t3ProjectFile.ts#L72-L118`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/t3ProjectFile.ts#L72-L118)).
  Onboarding could offer one; it is optional.

## Agent providers

### Which providers T3 supports

T3 has nine provider drivers
([`provider/builtInDrivers.ts#L29-L39`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/builtInDrivers.ts#L29-L39)).
Codex and Claude are on out of the box; the other six named drivers start off
([`contracts/src/settings.ts#L1280-L1290`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/settings.ts#L1280-L1290)).

| Driver id | What T3 runs | Out of the box |
| --- | --- | --- |
| `codex` | `codex app-server` ([`codexLaunchArgs.ts#L13`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/codexLaunchArgs.ts#L13)) | on |
| `claudeAgent` | Claude Agent SDK ([`apps/server/package.json#L35`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/package.json#L35)) | on |
| `cursor` | `@cursor/sdk` ([`provider-cursor/src/server/driver.ts#L46`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-cursor/src/server/driver.ts#L46)) | off |
| `grok` | `grok agent stdio` over ACP ([`provider-grok/src/server/acpSupport.ts#L47-L56`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-grok/src/server/acpSupport.ts#L47-L56)) | off |
| `opencode` | `@opencode-ai/sdk` against an OpenCode server ([`provider-opencode/src/server/driver.ts#L68`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-opencode/src/server/driver.ts#L68)) | off |
| `antigravity` | Google's `agy_acp_server` over ACP ([`AntigravityInstallation.ts#L139`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/AntigravityInstallation.ts#L139)) | off |
| `pi` | `pi --mode rpc` ([`provider-pi/src/settings.ts#L28`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-pi/src/settings.ts#L28)) | off |
| `muse` | `muse serve`, labelled Beta ([`provider-muse/src/client.ts#L10`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-muse/src/client.ts#L10)) | off |
| `acpRegistry` | Any agent from the ACP Registry, or a local command ([`provider-acp-registry/src/settings.ts#L10-L47`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-acp-registry/src/settings.ts#L10-L47)) | no instance until the user adds one |

- The user can run several instances of one driver. Settings hold `providerInstances`, keyed by
  instance id, each with a `driver`, environment variables, `enabled` and driver config. The
  default instance's id is the driver id
  ([`contracts/src/providerInstance.ts#L38-L82`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/providerInstance.ts#L38-L82)).
- A Claude instance's `homePath` becomes `CLAUDE_CONFIG_DIR`
  ([`Drivers/ClaudeHome.ts#L33-L43`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/Drivers/ClaudeHome.ts#L33-L43)),
  and a Codex instance's becomes `CODEX_HOME`
  ([`contracts/src/settings.ts#L596-L618`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/settings.ts#L596-L618)).
  The board already reads these homes for stats (`apps/server/src/t3/t3-settings.ts`).
- A project can turn a provider on or off for itself alone, in either direction
  ([`docs/user/project-settings.md#L30-L36`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/docs/user/project-settings.md#L30-L36)).
  So "every provider T3 supports" for one repository is the machine's enabled instances,
  adjusted by that project.

### What T3 adds to an agent

- T3 doesn't install, copy or inject skills or instruction files for any provider. It appends
  its own runtime and orchestration text to the system prompt
  ([`provider-core/src/server/runtimeInstructions.ts#L6-L21`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-core/src/server/runtimeInstructions.ts#L6-L21)).
  For Claude that is an `append` to the `claude_code` preset
  ([`ClaudeAdapterV2.ts#L1432-L1442`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1432-L1442)).
- T3 doesn't set `settingSources` on Claude sessions, so Claude loads user, project and local
  settings, including `CLAUDE.md`, skills and agents
  ([Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/claude-code-features)).
  Cursor sessions get project, user, team, MDM and plugin settings
  ([`provider-cursor/src/server/adapter.ts#L295-L322`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-cursor/src/server/adapter.ts#L295-L322)).
  OpenCode gets `OPENCODE_CONFIG_CONTENT="{}"`
  ([`OpenCodeRuntime.ts#L45`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/provider-opencode/src/server/OpenCodeRuntime.ts#L45)).
  Unconfirmed: whether that empty config hides the user's own OpenCode config.
- T3 reads `AGENTS.md` itself in one place: when it writes commit and PR messages in
  repository-conventions mode, it reads the repository's `AGENTS.md`, and `CLAUDE.md` when the
  writer is Claude ([`git/GitManager.ts#L816-L838`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/git/GitManager.ts#L816-L838)).
- The composer's slash menu lists skills
  ([`client-runtime/src/providerSkills.ts#L38`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/client-runtime/src/providerSkills.ts#L38)).
  For Claude it scans `<config dir>/skills` and `<cwd>/.claude/skills`
  ([`Drivers/ClaudeSkills.ts#L446-L466`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/Drivers/ClaudeSkills.ts#L446-L466)).
  Codex, OpenCode and Pi are asked for their list; Cursor and Antigravity folders are scanned.
  Grok, Muse and ACP agents show slash commands only. An installed skill showing in this menu
  is a check onboarding could point the user at.

### Where each agent loads skills and instructions

From each agent's own docs. Project paths are relative to the working folder unless noted.

| Agent | Skills: user, project | Instruction files | Custom agents |
| --- | --- | --- | --- |
| Claude Code ([skills](https://code.claude.com/docs/en/skills), [memory](https://code.claude.com/docs/en/memory), [subagents](https://code.claude.com/docs/en/sub-agents)) | `~/.claude/skills` (`$CLAUDE_CONFIG_DIR/skills` for an instance with a home), `.claude/skills` and nested `.claude/skills`. No `.agents` path. | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/`, `~/.claude/CLAUDE.md`. `AGENTS.md` only when there is no project `CLAUDE.md` | `~/.claude/agents`, `.claude/agents` |
| Codex ([skills](https://learn.chatgpt.com/docs/build-skills), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)) | `$HOME/.agents/skills`, `.agents/skills` from the folder up to the repository root | `$CODEX_HOME/AGENTS.override.md` or `AGENTS.md`, then one `AGENTS.override.md` or `AGENTS.md` per folder from the root down, plus `project_doc_fallback_filenames` | `~/.codex/agents/*.toml`, `.codex/agents/` |
| Cursor ([skills](https://cursor.com/docs/context/skills), [rules](https://cursor.com/docs/context/rules), [subagents](https://cursor.com/docs/context/subagents)) | `.agents`, `.cursor`, `.claude` and `.codex` `skills/`, in the home folder and the project | `.cursor/rules/*.mdc`, `AGENTS.md` at the root and nested; the CLI also reads a root `CLAUDE.md` | `.cursor`, `.claude`, `.codex` `agents/`, user and project |
| OpenCode ([skills](https://opencode.ai/docs/skills/), [rules](https://opencode.ai/docs/rules/), [agents](https://opencode.ai/docs/agents/)) | `~/.config/opencode`, `~/.claude`, `~/.agents` `skills/`; `.opencode`, `.claude`, `.agents` `skills/` up to the worktree | `AGENTS.md`, else `CLAUDE.md`; `~/.config/opencode/AGENTS.md`, else `~/.claude/CLAUDE.md`; the `instructions` key in `opencode.json` | `~/.config/opencode/agents/`, `.opencode/agents/` |
| Grok ([docs](https://docs.x.ai/build/features/skills-plugins-marketplaces)) | `~/.grok/skills`, `~/.agents/skills`, `.grok/skills` up the tree | `AGENTS.md`, `Agents.md`, `AGENT.md` up to the root, and Claude's `CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules` | Reads Claude's agents; paths unconfirmed |
| Pi ([configuration](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/configuration.md), [skills](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md)) | `~/.pi/agent/skills` (moves with `PI_CODING_AGENT_DIR`), `~/.agents/skills`, `.pi/skills`, `.agents/skills` up to the root | `AGENTS.md`, `CLAUDE.md`, `AGENTS.override.md` in the agent folder and from the folder up; `SYSTEM.md`, `APPEND_SYSTEM.md` | none by default |
| Antigravity ([skills](https://antigravity.google/docs/skills), [rules](https://antigravity.google/docs/rules)) | `~/.gemini/config/skills` (app), `~/.gemini/antigravity-cli/skills` (CLI), `.agents/skills`. Not `~/.agents/skills` | `AGENTS.md`, `GEMINI.md`, `.agents/AGENTS.md`, `.agents/GEMINI.md`, `.agents/rules/*.md` up to the workspace root | unconfirmed |
| Muse | unconfirmed: Meta's docs need a login | unconfirmed | unconfirmed |
| ACP Registry agents | depends on the agent | depends on the agent | depends on the agent |

T3 confirms the Antigravity folders: it runs Antigravity with a private `GEMINI_HOME` and links
the real `~/.gemini` skill folders into it, and its scanner skips `~/.agents/skills` on purpose
([`antigravityAuthSupport.ts#L222-L242`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/antigravityAuthSupport.ts#L222-L242),
[`Drivers/AntigravitySkills.ts#L150-L161`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/provider/Drivers/AntigravitySkills.ts#L150-L161)).

### What this means for installing skills

- `~/.agents/skills` covers Codex, Cursor, OpenCode, Grok and Pi. The board app installs there
  today (`packages/shared/src/install-skills.ts`).
- Claude needs the skills linked into each Claude home: `~/.claude/skills` and every Claude
  instance's `homePath/skills`. The board app already links into `~/.claude` and each
  `~/.claude-*` profile the user ticks; T3's `providerInstances` names the homes exactly.
- Antigravity needs `~/.gemini/config/skills` and `~/.gemini/antigravity-cli/skills`. The board
  app doesn't install there.
- A Codex instance with its own `CODEX_HOME` still reads `$HOME/.agents/skills`; the Codex docs
  don't list `$CODEX_HOME/skills`.
- Muse and ACP Registry agents have no confirmed skill folder.

### Instruction files onboarding's conflict check could look for

From the table above: `AGENTS.md`, `AGENTS.override.md`, `Agents.md`, `AGENT.md`, `CLAUDE.md`,
`CLAUDE.local.md` and `GEMINI.md` at any depth; `.claude/CLAUDE.md` and `.claude/rules/`;
`.cursor/rules/`; `.agents/AGENTS.md`, `.agents/GEMINI.md` and `.agents/rules/`;
`.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md`; the `instructions` key in `opencode.json`; and
project skill and agent folders (`.claude/skills`, `.agents/skills`, `.claude/agents`,
`.codex/agents`, `.opencode/agents`) that could hold a skill with the same name as a bundled one.
When two skills share a name, Claude Code prefers the user's over the project's, Pi keeps the
first it finds, and Codex lists both ([Claude](https://code.claude.com/docs/en/skills),
[Pi](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/skills.md),
[Codex](https://learn.chatgpt.com/docs/build-skills)).

## Source control and issue providers

T3 has six source control providers and no issue or board provider. It tracks pull requests and
nothing else: no issues, GitHub Projects, Azure Boards, sprints or work items.

### Which providers, and how T3 reaches them

The registry lists GitHub, GitLab, GitCafe, Forgejo, Bitbucket and Azure DevOps
([`source-control-definitions/src/registry.ts#L16-L35`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-definitions/src/registry.ts#L16-L35)),
and the server loads all six with no feature flag
([`sourceControl/sourceControlDefinitions.ts#L10-L17`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/sourceControl/sourceControlDefinitions.ts#L10-L17)).
Each host has an `enabled` setting that defaults to on
([`source-control-core/src/shared/definition.ts#L175-L178`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-core/src/shared/definition.ts#L175-L178)).

| Provider | How T3 calls it | Sign-in T3 checks |
| --- | --- | --- |
| GitHub | Its own REST and GraphQL calls with `GH_TOKEN`, `GITHUB_TOKEN`, a token saved in Settings, or `gh auth token` ([`GitHubCredentials.ts#L104-L115`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-github/src/server/GitHubCredentials.ts#L104-L115)) | `gh auth status --json hosts` ([`GitHubSourceControlProvider.ts#L189-L242`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-github/src/server/GitHubSourceControlProvider.ts#L189-L242)) |
| Azure DevOps | `az repos` and `az devops invoke`, from the `azure-devops` extension of the `az` CLI ([`AzureDevOpsPullRequestCli.ts#L281-L314`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestCli.ts#L281-L314)) | `az account show`; otherwise it asks for `az login` ([`AzureDevOpsSourceControlProvider.ts#L16-L54`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsSourceControlProvider.ts#L16-L54)) |
| GitLab | `glab mr` and `glab api` ([`GitLabCli.ts#L511`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-gitlab/src/server/GitLabCli.ts#L511)) | `glab auth status` |
| Forgejo | REST at `/api/v1` with the login of `tea` or `fj` ([`ForgejoCli.ts#L336-L345`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-forgejo/src/server/ForgejoCli.ts#L336-L345)) | `tea login status` or `fj whoami` |
| GitCafe | REST with `CAFE_TOKEN`, a saved token, or the `cafe` CLI ([`GitCafeCredentials.ts#L82-L105`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-gitcafe/src/server/GitCafeCredentials.ts#L82-L105)) | `cafe auth status --json` |
| Bitbucket | REST at `api.bitbucket.org/2.0` with `T3CODE_BITBUCKET_*` tokens ([`BitbucketApi.ts#L38-L51`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-bitbucket/src/server/BitbucketApi.ts#L38-L51)) | An API call |

### What T3 reads from each

Every provider implements the repository interface: list, get, create and check out a pull
request, clone URLs, create a repository and read the default branch
([`source-control-core/src/server/SourceControlProvider.ts#L171-L212`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-core/src/server/SourceControlProvider.ts#L171-L212)).
Pull request details vary
([`contracts/src/pullRequest.ts#L259-L284`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/pullRequest.ts#L259-L284)):

| Capability | GitHub | Azure DevOps | GitLab | Forgejo | GitCafe | Bitbucket |
| --- | --- | --- | --- | --- | --- | --- |
| CI checks | yes | no, always `checks: []` | yes | yes | yes | yes |
| Post a comment | yes | no, comments are read only | yes | yes | yes | yes |
| Inline review, reply, resolve | yes | no | yes | review only | reply and resolve | yes |
| Labels | yes | no | read only | yes | yes | no |
| Request reviewers | yes | yes | yes | yes | yes | yes |

Sources: the capability constants in each `*PullRequestProvider.ts`, for example
[GitHub `#L34-L59`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-github/src/server/GitHubPullRequestProvider.ts#L34-L59)
and [Azure DevOps `#L46-L61`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestProvider.ts#L46-L61).
Azure DevOps returns `checks: []`
([`#L328`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestProvider.ts#L328))
and answers every comment write with `unsupported`
([`#L556-L564`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestProvider.ts#L556-L564)).
It does merge, squash, close, reopen, draft, ready and auto-merge
([`azure-devops/src/shared/definition.ts#L97-L105`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/shared/definition.ts#L97-L105)).
It finds the organization and project with `--detect true` from the checkout's remote, so it
needs a checkout ([`AzureDevOpsCli.ts#L410`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsCli.ts#L410)).

### Issues and boards

- T3 reads an issue only for thread titles: a `github.com` or `gitlab.com` issue link in a
  message has its title and body read to name the thread
  ([`GitHubSourceControlProvider.ts#L898-L906`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-github/src/server/GitHubSourceControlProvider.ts#L898-L906),
  [`textGeneration/ThreadTitleLinks.ts#L14-L22`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/textGeneration/ThreadTitleLinks.ts#L14-L22)).
- Threads link to pull requests only: `link_pull_request`, `unlink_pull_request`,
  `list_thread_pull_requests`, `watch_pull_request` and `unwatch_pull_request`
  ([`mcp/toolkits/pullRequests/tools.ts#L266-L336`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/toolkits/pullRequests/tools.ts#L266-L336)).
  A watch wakes the thread on checks, comments, reviews and conflicts. On Azure DevOps it can't
  see checks. Unconfirmed: what a watch reports there.
- No source file uses GitHub's `ProjectV2` API or Azure DevOps work items, iterations or boards
  (searched `packages/source-control-*` and `apps/server/src`).

### Recognising a repository from its remote

- T3 runs `git remote -v` and prefers `upstream`, then `origin`
  ([`project/RepositoryIdentityResolver.ts#L73-L85`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/project/RepositoryIdentityResolver.ts#L73-L85),
  [`#L202-L219`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/project/RepositoryIdentityResolver.ts#L202-L219)).
  The board reads `origin` only, so a fork with an `upstream` remote resolves to different
  repositories in T3 and in the board.
- Azure DevOps claims `dev.azure.com`, every `*.dev.azure.com` host (including
  `ssh.dev.azure.com`) and every `*.visualstudio.com` host
  ([`azure-devops/src/shared/definition.ts#L118-L126`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/shared/definition.ts#L118-L126)).
  It stores SSH remotes in the `dev.azure.com/{org}/{project}/_git/{repo}` form and folds the
  `visualstudio.com` spellings into it when comparing
  ([`#L23-L45`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/shared/definition.ts#L23-L45)).
  Its repository selector is the last path segment without `_git`
  ([`#L131-L135`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/shared/definition.ts#L131-L135)).
- A self-hosted Azure DevOps Server on its own hostname isn't claimed and reads as `unknown`.
  Unconfirmed that no other code claims it.

## Threads from outside T3

The factory starts threads with `t3 thread start <project> <message> [--provider --model]
[--worktree --branch] --json` (`apps/server/src/t3/t3.ts`) and reads everything else from T3's
database. T3 also offers:

| Need | Supported way |
| --- | --- |
| Start and wait for the reply | `t3 thread start ... --wait` |
| Send a follow-up | `t3 thread send <thread> <message> [--wait] [--json]` |
| Read state and latest messages | `t3 thread show <thread> [--messages N] --json` |
| List a project's threads | `t3 thread list --project <id or path> --json` |
| Anything else (read a timeline, wait on a run, answer requests, interrupt, link PRs, list providers and models) | T3's MCP server at `<server>/mcp` |

- `t3 thread` signs in to the running server as a short-lived, full-access MCP client and calls
  the same MCP tools an agent would, then revokes the session
  ([`cli/thread.ts#L200-L240`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/thread.ts#L200-L240)).
  It needs a running server and fails with `ThreadServerNotRunningError` otherwise
  ([`#L212-L215`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/thread.ts#L212-L215)).
  New threads start at the project's default mode, not full access.
- T3's user docs name `t3 thread` as the way for scripts on the host machine; agents elsewhere
  connect to `/mcp` with an OAuth sign-in the user approves
  ([`docs/user/outside-agents.md#L95-L115`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/docs/user/outside-agents.md#L95-L115),
  [`#L33-L54`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/docs/user/outside-agents.md#L33-L54)).
- `--wait` exits 0 when the run completes, 1 when it fails or stops, and 2 when the agent waits
  for an answer in the app. With `--json` it prints `threadId`, `runId`, `status`, `reply` and
  `error` ([`cli/thread.ts#L385-L450`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/thread.ts#L385-L450)).
  It waits for that exact run, so a message sent by someone else meanwhile can't stand in for it.
- `<project>` is a project id or any path inside a project; the deepest project wins, and both
  sides compare as real paths
  ([`cli/thread.ts#L274-L305`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/thread.ts#L274-L305)).
- `thread list --json` prints each thread's `status`, `latestRunId`, `providerInstanceId`,
  `model`, `linkedPullRequest`, `pullRequests`, `settled`, `parentThreadId` and
  `relationshipToParent`. It leaves out subagent threads
  ([`cli/thread.ts#L499-L532`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/cli/thread.ts#L499-L532),
  [`contracts/src/orchestratorMcp.ts#L315-L338`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/orchestratorMcp.ts#L315-L338)).
  Status is `idle` or a run status: `preparing`, `queued`, `starting`, `running`, `waiting`,
  `completed`, `interrupted`, `failed`, `cancelled` or `rolled_back`
  ([`contracts/src/orchestrationV2.ts#L512-L523`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/orchestrationV2.ts#L512-L523)).
  These are the item thread states the board now derives from database rows.
- `orchestrator_capabilities` lists each provider instance with its models and a `constraints`
  list that says when the instance is disabled, its executable isn't installed, its status is an
  error, or it isn't signed in
  ([`contracts/src/orchestratorMcp.ts#L528-L567`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/contracts/src/orchestratorMcp.ts#L528-L567),
  [`mcp/OrchestratorMcpService.ts#L365-L389`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/OrchestratorMcpService.ts#L365-L389)).
  It is the ready-made check that each provider works. No `t3` subcommand wraps it, so only an
  agent thread or a signed-in MCP client can call it.
- A program on the host can't open its own MCP session the way `t3 thread` does: the CLI mints
  the session from T3's local secret store inside the `t3` process. Outside that, `/mcp` takes an
  OAuth client the user approves ([`mcp/McpHttpServer.ts#L149-L175`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/apps/server/src/mcp/McpHttpServer.ts#L149-L175)).
  Unconfirmed: whether a supported, non-interactive way exists for a local app such as the board.

## Open questions

- Should onboarding list projects through the database, as the board does today, or ask T3 to
  add `t3 project list --json`? The table name and columns have been stable since migration 005.
- Should the board's repository lookup use T3's `repositoryIdentity` (which prefers `upstream`)
  instead of running `git remote get-url origin` itself? It would then match what T3 shows and
  cover Azure DevOps URL shapes for free, but it is only on the MCP `Project`, not in the
  database.
- Onboarding's provider check needs `orchestrator_capabilities`, which no `t3` subcommand wraps.
  Run that step inside a T3 thread, or ask T3 for a CLI command?
- Antigravity's two `~/.gemini` skill folders aren't covered by the board's install today. Install
  there too, or support only the providers `~/.agents/skills` and Claude homes reach?
- Muse's skill and instruction folders are unconfirmed because Meta's docs need a login.
