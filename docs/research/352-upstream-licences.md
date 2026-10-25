# What upstream licences require of our copies

Research for [#352](https://github.com/maddec01/mux-factory/issues/352), part of the #70 map. It
feeds the credit format decision in #361.

Each upstream licence was read at the commit that `UPSTREAM.md` or `packages/ui/UPSTREAM.md`
records. This repo was read at `b29c347` (main on 2026-10-25). The shipped app was read from the
`v0.1.0-nightly.20261025.8` Release zip. Every licence text in `THIRD_PARTY_NOTICES.md` and
`packages/ui/licenses/` matches its upstream file byte for byte.

## Summary

- Every licensed source is MIT. The one condition MIT sets is that "the above copyright notice
  and this permission notice shall be included in all copies or substantial portions of the
  Software". It does not say where the notice has to sit.
- The repo carries every MIT notice in `THIRD_PARTY_NOTICES.md`. The app and the installed skills
  carry only T3's. The Release's `Resources/` has `LICENSE.t3code.txt` and nothing for Matt
  Pocock, Addy Osmani, Lauren Tan (`unslop`) or coss. `Resources/bundle/skills/*` and the
  `~/.agents/skills/<name>` folders installed from it have no licence file.
- `developer-profile` has no licence. Its upstream repo has no licence file and GitHub reports
  none. It belongs to maddec01, the owner of this repo, so only the owner can grant one.
- `unslop` is missing from the README's skills table, and the README's credits paragraph names
  only Matt Pocock, Addy Osmani and T3 Tools. Lauren Tan and coss are missing from it.
- A credit can sit next to a Copy without editing it. A Copy is a file, both installers copy a
  skill's whole folder, and `skill-sync` never deletes a local file that upstream lacks. A
  `LICENSE` inside `skills/<name>/` would install with the skill.
- Unconfirmed: whether `pr`'s `CREDITS.md` content brings Apache-2.0 duties from humanlayer, and
  whether T3's base components need coss's notice too.

## One row per copy

| Copy | Upstream at commit | Licence | Required notice | Where we carry it today | Gap |
| --- | --- | --- | --- | --- | --- |
| `grilling`, `domain-modeling`, `prototype`, `research`, `diagnosing-bugs`, `tdd`, `code-review`, `codebase-design`, `writing-for-agents`, `pr`, `retro`, `handoff`, `to-tickets`, `implement` | mattpocock/skills `5beb35b` [LICENSE][matt] | MIT | "Copyright (c) 2026 Matt Pocock" and the MIT permission notice | `THIRD_PARTY_NOTICES.md`, README credits paragraph | None in the app's `Resources/bundle/skills/`, none in `~/.agents/skills/<name>`, none in a skill folder fetched on its own |
| `pr/CREDITS.md` content from `show-me` | humanlayer/humanlayer, by way of Matt's `pr` ([CREDITS.md][matt-credits]) | Apache-2.0 today ([LICENSE][hl-license], [NOTICE][hl-notice]); unconfirmed when Matt copied it | Apache-2.0 §4: give recipients the licence, keep copyright notices, pass on `NOTICE` text, mark changed files ([licence][apache]) | `skills/pr/CREDITS.md`, a Copy that names Dex Horthy and links humanlayer but has no licence text. It ships in the app | Unconfirmed. See [The `pr` skill's credit](#the-pr-skills-credit) |
| `code-review-and-quality`, `security-and-hardening`, `doubt-driven-development`, `frontend-ui-engineering`, `browser-testing-with-devtools`, and the four `references/*.md` | addyosmani/agent-skills `aeac41d` [LICENSE][addy] | MIT | "Copyright (c) 2025 Addy Osmani" and the MIT permission notice | `THIRD_PARTY_NOTICES.md`, README credits paragraph | Same as Matt's. `references/` also installs to `~/.agents/references/` and each Claude profile's `references/` with no licence |
| `unslop` | cursor/plugins `8b3326d`, path `pstack/skills/unslop` [pstack/LICENSE][pstack] | MIT. The licence is `pstack/LICENSE`; the repo root has none | "Copyright (c) 2026 Lauren Tan" and the MIT permission notice | `THIRD_PARTY_NOTICES.md` only | Not in the README table or credits paragraph. None in the app or the installs |
| `developer-profile` | maddec01/developer-profile-skill `18d4038` [tree][devprof] | None. No licence file in the tree, and the GitHub API's `license` is `null` | None that a licence sets. With no licence, nobody else gets a grant to copy it | Nowhere. No `THIRD_PARTY_NOTICES.md` section | No recorded licence. `skill-sync` step 4 lets an unlicensed copy in once the owner says yes |
| 26 files in `packages/ui/src` (`components/`, `hooks/`, `lib/`) | pingdotgg/t3code `d53873b` [LICENSE][t3] | MIT | "Copyright (c) 2026 T3 Tools Inc." and the MIT permission notice | `packages/ui/licenses/t3code.txt`, `THIRD_PARTY_NOTICES.md`, `apps/desktop/LICENSE`, and the app's `Resources/LICENSE.t3code.txt` | None found for T3. The components appear to derive from coss's registry; see [T3's components and coss](#t3s-components-and-coss) |
| `packages/ui/src/coss/toast.tsx` | cosscom/ui `3d8ca28`, path `apps/ui/registry/default/ui/toast.tsx` ([LICENSING.md][coss-licensing]) | MIT. The repo default is AGPL-3.0 ([LICENSE][coss-agpl]); `LICENSING.md` keeps `apps/origin/` and `apps/ui/` MIT | "Copyright (c) 2025 coss.com, Originally Copyright (c) 2025 Origin UI" and the MIT permission notice ([apps/origin/LICENSE.md][coss-mit]) | `packages/ui/licenses/coss.txt`, `THIRD_PARTY_NOTICES.md` | Not in the app: `Resources/` has no coss licence, and the web bundle keeps no comments. Not in the README credits paragraph |
| T3 Ports in `apps/desktop` and `apps/web`, and `.github/` release scripts. Not Copies; listed because they ship | pingdotgg/t3code [LICENSE][t3] | MIT | As for T3's Copies | A header in each Port pointing at `apps/desktop/LICENSE`, and the app's `LICENSE.t3code.txt` | None found |

## What ships where

The repo is covered. `THIRD_PARTY_NOTICES.md` holds the MIT text for Matt, Addy, pstack, T3 and
coss, and `packages/ui/licenses/` holds T3's and coss's again next to the Copies.

The app carries less. `apps/desktop/scripts/build-desktop-artifact.ts` adds one licence through
`extraResources` (`{ from: "LICENSE", to: "LICENSE.t3code.txt" }`), and `apps/desktop/vite.config.ts`
copies `skills/` and `references/` into `dist-electron/bundle` as they are. The Release zip lists
these licence files: `LICENSE.t3code.txt`, plus `LICENSE.electron.txt` and `LICENSES.chromium.html`
from Electron. `Resources/web/dist/assets/index-*.js` contains no "copyright" string at all.

The installed skills carry nothing. `packages/shared/src/install-skills.ts` copies each folder in
`<bundle>/skills` to `~/.agents/skills/<name>` with `cpSync(..., { recursive: true })`, and
`<bundle>/references` to `~/.agents/references`. None of those folders has a licence file today.

Someone who runs `npx skills add maddec01/mux-factory` gets the same folders. The `skills` CLI's
`copyDirectory` copies a skill's whole folder and skips only `metadata.json`, `.git`,
`__pycache__` and `__pypackages__` ([installer.ts][skills-cli] at `a80e4c9`).

## Carrying credit without editing a Copy

The glossary defines a Copy as "a file taken unchanged from an upstream source". A new file beside
it changes no Copy. Four facts make a sibling `LICENSE` in `skills/<name>/` work.

1. MIT asks for the notice in "all copies or substantial portions" and names no place for it
   ([Matt's LICENSE][matt]). A licence file inside the copied folder puts it in the same copy.
2. Both installers copy the whole folder, so the file reaches `~/.agents/skills/<name>` and every
   agent the `skills` CLI writes to (see above).
3. `skill-sync` survives it. `upstream-changes.sh` diffs only the upstream path, "Take a change"
   copies upstream files over the copy, and no step deletes a file upstream doesn't have.
4. None of the copied upstream folders holds a licence file today, so no name clashes. The trees
   at the recorded commits have licences only at the repo root (Matt, Addy, T3), at `pstack/`
   (cursor/plugins), or at the root and `apps/origin/` (coss).

The Agent Skills spec allows it too. A skill folder "may contain any files and directories beyond
the required `SKILL.md`", and the optional `license` frontmatter field can name "a bundled license
file" ([spec][agentskills]). That field would mean editing `SKILL.md`, so it is closed to Copies.

Upstream projects already do this. cursor/plugins keeps a `LICENSE` in each plugin folder
(`pstack/LICENSE`), and humanlayer's `NOTICE` says of its MIT folders, "Each folder keeps its own
LICENSE file" ([NOTICE][hl-notice]).

`references/` is one folder of Addy's files, so one `references/LICENSE` covers all four.
`packages/ui/licenses/` already sits beside its Copies; the app's gap there is packaging, which
`build-desktop-artifact.ts` controls and which is no Copy.

## The `pr` skill's credit

Matt's `skills/engineering/pr/CREDITS.md` says the Summary section's visuals menu comes from Dex
Horthy's `show-me` skill, "reproduced almost word for word" ([CREDITS.md][matt-credits]). Our copy
matches it byte for byte, and it ships in the app.

Matt added it on 2026-09-24 ([commit][matt-credits-commit]). humanlayer/humanlayer is Apache-2.0
with a `NOTICE` today, but both the `NOTICE` and the `show-me` skill first appear in that repo on
2026-10-22, in a commit that replaced the earlier code ([commit][hl-commit]). The earlier `LICENSE`
was also Apache-2.0, "Copyright (c) 2024, humanlayer Authors" ([LICENSE at 8114da9][hl-legacy]).
Where Matt took `show-me` from on 2026-09-24, and under which licence, is unconfirmed. Whether a
reproduced menu is a "substantial portion" is a legal judgement this research can't settle. Since
`CREDITS.md` is a Copy, any change to it has to come from Matt's repo.

## T3's components and coss

T3's `apps/web/components.json` registers `"@coss": "https://coss.com/ui/r/{name}.json"`
([components.json][t3-components]), and T3's `checkbox.tsx` has the same structure as coss's
`apps/ui/registry/default/ui/checkbox.tsx`, with edited class strings. That suggests T3's base
components derive from coss's MIT registry. T3's `third-party-licenses.config.json` has no coss
entry ([config][t3-tpl]). If that reading holds, the coss notice applies to the T3 Copies too, and
the app ships it for neither. This is an inference from the code, not a statement by T3 or coss.

## Outside this issue

The app's JavaScript bundles React, Base UI, Effect, lucide and other npm packages, and ships none
of their notices; the web bundle has no "copyright" string. T3 generates a notices file from
`third-party-licenses.config.json` for its own builds ([config][t3-tpl]). That is a dependency
question rather than a Copy question, but #361 may want one notices file for both.

## Open questions for #361

1. Format. One root `THIRD_PARTY_NOTICES.md`, a `LICENSE` in each copied folder, or both? Only
   the per-folder file reaches installed skills.
2. The app. Add `THIRD_PARTY_NOTICES.md` to `extraResources`, show it in the app, or both?
3. `developer-profile`. Add a licence to maddec01/developer-profile-skill, or take the skill out of
   the public repo, as #70's "names no person" may require anyway?
4. `show-me`. Ask Matt Pocock or humanlayer where it came from and under which licence, or accept
   `CREDITS.md` as Matt ships it?
5. coss for T3's components. Ship coss's notice with T3's on the strength of the inference above?

[matt]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/LICENSE
[matt-credits]: https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/pr/CREDITS.md
[matt-credits-commit]: https://github.com/mattpocock/skills/commit/a7d038f6bf7f01b516408e95e2fb56e0b338fa6f
[addy]: https://github.com/addyosmani/agent-skills/blob/aeac41d4d005999432bb7312f7ff06383a91d59d/LICENSE
[pstack]: https://github.com/cursor/plugins/blob/8b3326d99fd4b993cb33a24dad8af03175c642c5/pstack/LICENSE
[devprof]: https://github.com/maddec01/developer-profile-skill/tree/18d4038414b4ed1624a1ef408d58843da8188153
[t3]: https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/LICENSE
[t3-components]: https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/web/components.json
[t3-tpl]: https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/third-party-licenses.config.json
[coss-licensing]: https://github.com/cosscom/ui/blob/3d8ca28e7d90123e9e0f44665944dc240b026ccb/LICENSING.md
[coss-agpl]: https://github.com/cosscom/ui/blob/3d8ca28e7d90123e9e0f44665944dc240b026ccb/LICENSE
[coss-mit]: https://github.com/cosscom/ui/blob/3d8ca28e7d90123e9e0f44665944dc240b026ccb/apps/origin/LICENSE.md
[hl-license]: https://github.com/humanlayer/humanlayer/blob/d8197bab07017a2e2bef91bc25b2ebec6a4575b4/LICENSE
[hl-notice]: https://github.com/humanlayer/humanlayer/blob/d8197bab07017a2e2bef91bc25b2ebec6a4575b4/NOTICE
[hl-commit]: https://github.com/humanlayer/humanlayer/commit/d8197bab07017a2e2bef91bc25b2ebec6a4575b4
[hl-legacy]: https://github.com/humanlayer/humanlayer/blob/8114da9251b9/LICENSE
[apache]: https://www.apache.org/licenses/LICENSE-2.0
[agentskills]: https://agentskills.io/specification
[skills-cli]: https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/installer.ts#L475-L545
