---
name: skill-sync
description: Review upstream changes to the skills copied into lar-factory, take the ones the maintainer picks, and add or drop copies. Use when the maintainer runs /skill-sync.
disable-model-invocation: true
---

The copied skills in `maddec01/lar-factory` change only through this skill.
`UPSTREAM.md` records the upstream commit each copy matches. This is the
maintainer's tool: the maintainer runs it in the factory, and users get skills only
through a Release.

Before writing anything, read the `unslop` skill
(`~/.claude/skills/unslop/SKILL.md` in Claude Code,
`~/.agents/skills/unslop/SKILL.md` in Codex) and follow its rules for all prose
you write: chat, commit messages, the PR body and `UPSTREAM.md`. Apply them while
drafting, as you write each sentence, not as a later scan-and-rewrite pass. Code
and copied files follow their own rules.

1. Work in a fresh branch `chore/skill-sync-<date>` of the lar-factory checkout
   (`~/Developer/lar/lar-factory`), updated from `origin/main`.
2. Run `bash <this skill>/scripts/upstream-changes.sh <checkout>`. It prints, per
   copy, whether upstream changed since the recorded commit, upstream HEAD's
   12-character sha and date (`== <name>: changed (<source>
   <commit>..<head>, <date>)`), the upstream commits and the diff of the
   copy's path and of the licence file its `LICENSE` comes from. Then run
   `bash <this skill>/scripts/override-changes.sh <checkout>`. It prints each
   Override (a lar rule that sets aside part of a Copy, listed in the row's
   "Overridden in" column) whose cited section upstream changed, and each one
   whose cited heading or file upstream renamed or deleted. When it flags
   none it prints `no Overrides touched`; tell the maintainer so.
3. For each changed copy, summarise in two or three lines what changed and what
   it would do to the factory, and give your recommendation: take or skip. Show
   every Override the script printed for that copy, verbatim, and say whether the
   change means the Override needs rewording or a new citation. A
   change is taken whole or skipped whole. Ask the maintainer to pick, using numbered
   questions so they can answer in one message. In the same message ask whether
   they want to add a copy (source repo, path, commit; HEAD unless they name one)
   or drop one.
4. Confirm each add and drop with the maintainer before step 5:
   - **Add**: run
     `bash <this skill>/scripts/preview-copy.sh <owner/repo> <path> [commit]`.
     It prints the source's HEAD, the commit to copy, the files at the path,
     the source's licence files and, after `LICENSE from:`, the one the Copy's
     `LICENSE` will hold. Show the maintainer that output and wait for their
     yes. If the script fails (no files at the path, unknown commit), stop and
     ask them for the source again. If it prints `LICENSE from: none`, tell them
     so before they confirm; add the copy without a `LICENSE` or a
     `THIRD_PARTY_NOTICES.md` section only if they still say yes.
   - **Drop**: name what goes (the folder, its `UPSTREAM.md` row, the
     Overrides in that row's "Overridden in" column, and the source's full
     commit and notice if no other row uses that source) and wait for their yes.
5. Apply exactly what they confirmed:
   - **Take a change**: make the Copy's folder or file match upstream's path
     at the new commit. Copy every upstream file whole. Delete each file
     upstream deleted there, inside the Copy's own folder under
     `skills/<name>/` only, and keep its `LICENSE`; a single-file Copy changes
     only that file. In its
     `UPSTREAM.md` row, set the commit to the 12-character upstream commit you
     took and the Date to that commit's date as YYYY-MM-DD (the `<head>` and
     `<date>` upstream-changes.sh printed for that copy).
     When the maintainer agreed in step 3 that an Override needs rewording or a new
     citation, reword it in its lar file and update its "Overridden in" entry
     in the same commit as the take.
   - **Skip a change**: leave the copy and its row alone. The change shows up
     again on the next sync; tell the maintainer so. Skips are recorded nowhere.
   - **Add**: copy the folder at that commit unchanged into `skills/<name>` (a
     file under `references/` goes to `references/`). Add its `UPSTREAM.md` row
     with the 12-character commit and that commit's date as YYYY-MM-DD, and
     the source's full commit to the "Full commits" line. When the source is
     new, add its licence to `THIRD_PARTY_NOTICES.md` under a
     `## <owner/repo>` heading with its URL.
   - **Drop**: delete the copy and its `UPSTREAM.md` row, and remove each
     Override that row lists from its lar file. Deleting a folder deletes its
     `LICENSE`; delete `references/LICENSE` once no row lists a file under
     `references/`. When no row uses its
     source any more, also remove that source's full commit and its
     `THIRD_PARTY_NOTICES.md` section. Tell the maintainer the installed copies in
     `~/.agents/skills` and `~/.claude/skills` stay, since they use them in
     projects outside the factory; they remove them by hand if they want them gone.

   After any take or add, run `bash <this skill>/scripts/copy-licences.sh <checkout>`.
   For every `UPSTREAM.md` row it writes the source's licence file at the row's
   commit, byte for byte, to `LICENSE` in the Copy's folder (`references/LICENSE`
   for the files under `references/`). It picks the licence file with the same
   rule as `preview-copy.sh` and `upstream-changes.sh`: the nearest one from the
   upstream path up to the repo root, such as `pstack/LICENSE` in cursor/plugins.
   It prints each `LICENSE` it writes or removes, and `no licence: <name>` for a
   source with none, whose Copy gets no `LICENSE`. Commit its changes with the
   take or add. Only this script writes a Copy's `LICENSE`; lar's own skills
   have none.
6. Commit as `chore(skills): sync <names> from upstream` (`feat(skills): add
   <name> as a copy` or `chore(skills): drop <name>` for add and drop), push,
   and open a PR listing what was taken, skipped, added and dropped. The maintainer
   merges it.
7. Tell them to start a Release after merging and install it. The board app's
   first launch of the new version updates the skills and the checklists in
   `references/`, and installs an added copy with no further edit.

Never edit a copy for lar reasons. lar rules belong in `lar-work` or a repo's
`AGENTS.md`.
