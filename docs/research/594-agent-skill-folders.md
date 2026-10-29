# Agent instances and skill folders

Research for [#594](https://github.com/maddec01/lar-factory/issues/594), part of the #490 map.

Sources read on 2026-10-29:

- T3 Code: `pingdotgg/t3code` at
  [`37fbefd`](https://github.com/pingdotgg/t3code/tree/37fbefd147197fab9d88f9c120560c3f21b52cfc) (main).
  Short paths below (`contracts/…`, `server/…`) are under `packages/` and `apps/` there.
- Codex: `openai/codex` at [`2681f8c`](https://github.com/openai/codex/tree/2681f8cba2831ef72bca2c0672b2e49d5f690745); installed `codex-cli 0.164.0`.
- Pi: `badlogic/pi-mono` at [`e7a0df2`](https://github.com/badlogic/pi-mono/tree/e7a0df27c09d11bf4161d3605246cbf57a129cb2).
- Provider docs: [Claude Code skills](https://code.claude.com/docs/en/skills),
  [OpenCode skills](https://opencode.ai/docs/skills/),
  [Grok Build skills](https://docs.x.ai/build/features/skills-plugins-marketplaces),
  [Muse Code extending](https://dev.meta.ai/docs/muse-code/extending),
  [Pi skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md).
- This machine's `~/.t3/userdata/settings.json`, for its shape only.

## Summary

- T3 keeps provider instances in `settings.json` under `providerInstances`, but only the ones the
  User changed. Every built-in driver also has a default instance whose id is the driver name,
  added at runtime and never written to the file. Here the file lists two Claude instances; the
  other eight instances are defaults.
- Only Claude and Codex instances have a home setting (`config.homePath`). Every other driver
  takes its home from the process environment, which an instance can override through its
  `environment` list (for example `HOME`, `GROK_HOME`, `XDG_CONFIG_HOME`).
- `~/.agents/skills` reaches Codex, Cursor, OpenCode, Grok, Pi, Muse and fx. Claude needs each
  instance's `<CLAUDE_CONFIG_DIR>/skills`. Antigravity needs `~/.gemini/config/skills` and
  `~/.gemini/antigravity-cli/skills`, and T3 links each Antigravity instance's private home to
  those two folders.
- The board app already copies into `~/.agents/skills`, so Codex probably loads the skills (from
  source; not checked in a running session). It "misses" Codex because it never detects Codex:
  its only targets are `.claude*` folders in the home and the two Antigravity folders. For the same
  reason it misses a Claude instance whose `homePath` sits anywhere else, which one instance on
  this machine does.

## 1. How T3 stores provider instances

**File.** `~/.t3/userdata/settings.json` (or `T3_SETTINGS`), key `providerInstances`: a record from
instance id to `ProviderInstanceConfig`
([contracts/src/settings.ts:1305](https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/contracts/src/settings.ts#L1305)).
Each entry has these fields
([contracts/src/providerInstance.ts:42](https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/contracts/src/providerInstance.ts#L42)):

| Field | Meaning |
|---|---|
| `driver` | Driver kind: `claudeAgent`, `codex`, `cursor`, `grok`, `opencode`, `antigravity`, `fx`, `muse`, `pi`, … |
| `displayName`, `accentColor` | Labels only. |
| `enabled` | Optional; see enabled state below. |
| `environment` | Optional list of `{ name, value, sensitive }` env vars merged into the agent's process (`mergeProviderInstanceEnvironment`, `provider-core/src/server/instanceEnvironment.ts`). Values may be secret. |
| `config` | Driver-specific, typed `Unknown`. Codex: `homePath` (CODEX_HOME), `shadowHomePath`, `binaryPath`, … (settings.ts:626). Claude: `homePath` (CLAUDE_CONFIG_DIR), `binaryPath`, … (settings.ts:705). Antigravity: no home field (settings.ts:787). |

**Default instances are not in the file.** `deriveProviderInstanceConfigMap` adds
`{ driver }` under the id `<driver>` for every built-in driver missing from the record
([server/src/provider/ProviderInstanceRegistryHydration.ts:45-56](https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/apps/server/src/provider/ProviderInstanceRegistryHydration.ts#L45-L56)).
On this machine the file holds only `claudeAgent` and `claudeAgent_personal`; `codex`, `cursor`,
`grok`, `opencode`, `antigravity`, `fx`, `muse` and `pi` come from that step. A reader that only
reads the file misses them.

**Enabled state.** `resolveProviderInstanceEnabled`: `false` in either `enabled` or
`config.enabled` disables the instance; otherwise the first set flag wins; otherwise the driver's
default. `cursor`, `grok`, `fx`, `muse`, `pi`, `opencode` and `antigravity` default to off; `codex`
and `claudeAgent` to on
([settings.ts:1341-1365](https://github.com/pingdotgg/t3code/blob/37fbefd147197fab9d88f9c120560c3f21b52cfc/packages/contracts/src/settings.ts#L1341-L1365)).
A project can turn an instance on just for itself (`projectSettingsOverrides[<project>].providerInstances[<id>].enabled`),
and T3 then probes that instance even if it is off machine-wide (Hydration.ts:58-74).

**Home path.**

- Claude: `config.homePath`, `~` expanded; else the inherited `CLAUDE_CONFIG_DIR`; else `~/.claude`
  (`server/src/provider/Drivers/ClaudeHome.ts:12-29`). T3 passes it to the CLI as `CLAUDE_CONFIG_DIR`, not `HOME`.
- Codex: `config.homePath`, else `~/.codex`, is the shared `CODEX_HOME`. With `shadowHomePath`
  set, the agent runs in the shadow home, which symlinks the shared home's `skills` and other
  folders and keeps its own `auth.json` (`server/src/provider/Drivers/CodexHomeLayout.ts:16-28,47-71`).
- All other drivers: no home setting. The home is the process `HOME` (or a driver variable such
  as `GROK_HOME`, `PI_CODING_AGENT_DIR`, `XDG_CONFIG_HOME`) after the instance's `environment` is merged.

**Is there a steadier interface?** T3's WebSocket RPC `server.getConfig`
(`contracts/src/rpc.ts:490`) returns a `ServerProvider` per instance with `instanceId`, `driver`,
`enabled`, `installed`, and `skills` (each with its `path`) as each driver discovered them
(`contracts/src/server.ts:206-268`). Only Codex fills `runtimePaths.homePath`. It needs a
running, authenticated server, and the `t3` CLI has no command that prints providers (`t3 --help`:
no `provider` subcommand). So the practical path is still reading `settings.json` read-only,
**plus** adding the default instance for each built-in driver, as T3 does. The board's
`apps/server/src/t3/t3-settings.ts` already does this for `claudeAgent` and `codex` only.

## 2. Skill folders per driver

User-scope folders only; every driver also reads project folders under the working directory.

| Driver | How the instance home is set | User skills folder(s) | Reads `~/.agents/skills` | Sources |
|---|---|---|---|---|
| `claudeAgent` | `config.homePath` → `CLAUDE_CONFIG_DIR`; default `~/.claude` | `<CLAUDE_CONFIG_DIR>/skills`, plus plugin skills | No | T3 `ClaudeSkills.ts:410-448`, `ClaudeHome.ts:12-41`; Claude Code docs |
| `codex` | `config.homePath` → `CODEX_HOME`; default `~/.codex`; optional `shadowHomePath` shares `skills/` | `$HOME/.agents/skills`; `$CODEX_HOME/skills` (deprecated, still read); `/etc/codex/skills`; bundled system skills | Yes, from `$HOME`, not `CODEX_HOME` | codex `ext/skills/src/host_roots.rs:27-28,112-160`; T3 `CodexHomeLayout.ts` |
| `cursor` | No setting; `HOME` from instance `environment` | `~/.cursor/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills`; `~/.cursor/skills-cursor` is Cursor's own | Yes | T3 `provider-cursor/src/server/skills.ts:211-231` (T3's port of Cursor's rules; no Cursor doc read) |
| `grok` | No setting; `HOME`/`GROK_HOME` from instance `environment` | `~/.grok/skills`, `~/.agents/skills`, plugin `skills/`, extra `[skills] paths` in `~/.grok/config.toml` | Yes | xAI Grok Build docs; T3 asks `grok inspect --json` (`provider-grok/src/server/skills.ts:92-100`) |
| `opencode` | No setting; `HOME`/`XDG_CONFIG_HOME` from instance `environment` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | Yes | OpenCode docs; T3 reads OpenCode's own inventory (`provider-opencode/src/server/status.ts:364`) |
| `antigravity` | No home setting. T3 gives each instance a private `GEMINI_HOME` and links its two skill folders to the real `~/.gemini` ones | `~/.gemini/config/skills`, `~/.gemini/antigravity-cli/skills` | No (`.agents/skills` is project-only) | T3 `AntigravitySkills.ts:26-34,141-160`, `antigravityAuthSupport.ts:233-245,418` |
| `fx` | No setting; reads only under a set `HOME` | `~/.fx/skills` (does not follow links), `~/.config/opencode/skills`, `~/.codex/skills`, `~/.claude/skills`, `~/.agents/skills`, `~/.claw/skills` | Yes (follows links) | T3 `provider-fx/src/server/skills.ts:16-43`, which ports fx 0.0.13 `src/builtins/skills.zig` |
| `muse` | No setting; `HOME`/`XDG_CONFIG_HOME`/`CODEX_HOME` from instance `environment` | `$XDG_CONFIG_HOME/muse/skills`, `~/.agents/skills`; also `~/.claude/skills` and `$CODEX_HOME/skills` unless a preference turns these off | Yes | Muse Code docs (extending). T3 has no Muse skill discovery |
| `pi` | No setting; `PI_CODING_AGENT_DIR` (default `~/.pi/agent`) from instance `environment` | `<agent dir>/skills`, `~/.agents/skills` | Yes | pi-mono `coding-agent/src/config.ts:584-611`, `core/skills.ts:458-463`, `core/package-manager.ts:2564`; Pi docs |

**Drivers without native skills.** None: all nine drivers T3 runs on this machine load
`SKILL.md` folders. So no driver needs a stand-in target such as an instruction file. ACP
Registry agents (`packages/provider-acp-registry`) were not checked; none are set up here.

**One folder covers most.** Only Claude and Antigravity need their own targets. For every other
driver, `~/.agents/skills` under the instance's effective `HOME` covers it. That `HOME` differs
from the User's only when the instance's `environment` sets `HOME`, and then it can't be seen
from `settings.json` without reading `environment` (values may be secret; read the name only).
Codex's `$CODEX_HOME/skills` is deprecated, so a custom `CODEX_HOME` needs no extra target.

## 3. Why the board app misses Codex

The engine decides its targets without reading T3:

- `packages/shared/src/install-skills.ts:17`: `ANTIGRAVITY_FOLDERS`, two fixed folders.
- `packages/shared/src/install-skills.ts:150`: the shared copy in `<home>/.agents/skills`.
- `packages/shared/src/install-skills.ts:219` and `:288-298`: profiles are folders in the home
  named `.claude` or `.claude-*` (`listProfileFolders`, `isProfileName`); `listClaudeProfiles`
  (`:249-252`) is the whole target list the app shows (`apps/desktop/src/skills/claude-profiles.ts:34`).
- `apps/desktop/src/skills/skill-install.ts:54-57,81`: the plan passes only the home, the bundle
  and the version, with no instance list.

Nothing names Codex, so the app never lists it as a target or reports its state. The copy in
`~/.agents/skills` does reach Codex (`host_roots.rs:142-146`), but by accident. The same scan
misses any Claude instance whose `homePath` is not a `.claude*` folder directly in the home; one
of this machine's two Claude instances is like that, so it gets no skills.

## Open questions

1. Read `settings.json` (plus T3's default instances) or call `server.getConfig`? The RPC gives
   T3's own view, including skills each instance found, but needs a running, authenticated server.
2. Should the board read an instance's `environment` *names* (`HOME`, `CLAUDE_CONFIG_DIR`, …) to
   find its effective home, or treat custom homes through env as a by-hand target?
3. Install for disabled instances too? Most drivers are off by default, and a project can turn
   one on for itself.
4. Codex's own folder: rely on `~/.agents/skills` only, or also write the deprecated
   `$CODEX_HOME/skills` for older Codex versions?
5. Cursor's and fx's folders come from T3's ports, not the vendors' docs; Muse's user folders come
   from Meta's docs only. Confirm in a running session if it matters.
