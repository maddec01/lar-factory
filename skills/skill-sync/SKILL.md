---
name: skill-sync
description: Review upstream changes to the skills copied into lar-factory, take the ones Pedro picks, and add or drop copies. Use when the user runs /skill-sync.
disable-model-invocation: true
---

The copied skills in `maddec01/lar-factory` change only through this skill.
`UPSTREAM.md` records the upstream commit each copy matches. This is the
maintainer's tool: Pedro runs it in the factory, and users get skills only
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
   <commit>..<head>, <date>)`), the upstream commits and the diff. Then run
   `bash <this skill>/scripts/override-changes.sh <checkout>`. It prints each
   Override (a lar rule that sets aside part of a Copy, listed in the row's
   "Overridden in" column) whose cited section upstream changed, and each one
   whose cited heading or file upstream renamed or deleted. When it flags
   none it prints `no Overrides touched`; tell Pedro so.
3. For each changed copy, summarise in two or three lines what changed and what
   it would do to the factory, and give your recommendation: take or skip. Show
   every Override the script printed for that copy, verbatim, and say whether the
   change means the Override needs rewording or a new citation. A
   change is taken whole or skipped whole. Ask Pedro to pick, using numbered
   questions so he can answer in one message. In the same message ask whether
   he wants to add a copy (source repo, path, commit; HEAD unless he names one)
   or drop one.
4. Confirm each add and drop with Pedro before step 5:
   - **Add**: run
     `bash <this skill>/scripts/preview-copy.sh <owner/repo> <path> [commit]`.
     It prints the source's HEAD, the commit to copy, the files at the path
     and the source's licence files. Show Pedro that output and wait for his
     yes. If the script fails (no files at the path, unknown commit), stop and
     ask him for the source again. If it lists no licence files, tell him so
     before he confirms; add the copy without a `THIRD_PARTY_NOTICES.md`
     section only if he still says yes.
   - **Drop**: name what goes (the folder, its `UPSTREAM.md` row, the
     Overrides in that row's "Overridden in" column, and the source's full
     commit and notice if no other row uses that source) and wait for his yes.
5. Apply exactly what he confirmed:
   - **Take a change**: make the Copy's folder or file match upstream's path
     at the new commit. Copy every upstream file whole. Delete each file
     upstream deleted there, inside the Copy's own folder under
     `skills/<name>/` only; a single-file Copy changes only that file. In its
     `UPSTREAM.md` row, set the commit to the 12-character upstream commit you
     took and the Date to that commit's date as YYYY-MM-DD (the `<head>` and
     `<date>` upstream-changes.sh printed for that copy).
     When Pedro agreed in step 3 that an Override needs rewording or a new
     citation, reword it in its lar file and update its "Overridden in" entry
     in the same commit as the take.
   - **Skip a change**: leave the copy and its row alone. The change shows up
     again on the next sync; tell Pedro so. Skips are recorded nowhere.
   - **Add**: copy the folder at that commit unchanged into `skills/<name>` (a
     file under `references/` goes to `references/`). Add its `UPSTREAM.md` row
     with the 12-character commit and that commit's date as YYYY-MM-DD, and
     the source's full commit to the "Full commits" line. When the source is
     new, add its licence to `THIRD_PARTY_NOTICES.md` under a
     `## <owner/repo>` heading with its URL.
   - **Drop**: delete the copy and its `UPSTREAM.md` row, and remove each
     Override that row lists from its lar file. When no row uses its
     source any more, also remove that source's full commit and its
     `THIRD_PARTY_NOTICES.md` section. Tell Pedro the installed copies in
     `~/.agents/skills` and `~/.claude/skills` stay, since he uses them in
     projects outside the factory; he removes them by hand if he wants them gone.
6. Commit as `chore(skills): sync <names> from upstream` (`feat(skills): add
   <name> as a copy` or `chore(skills): drop <name>` for add and drop), push,
   and open a PR listing what was taken, skipped, added and dropped. Pedro
   merges it.
7. Tell him to start a Release after merging and install it. The board app's
   first launch of the new version updates the skills and the checklists in
   `references/`, and installs an added copy with no further edit.

Never edit a copy for lar reasons. lar rules belong in `lar-work` or a repo's
`AGENTS.md`.
