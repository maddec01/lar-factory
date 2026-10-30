#!/bin/bash
# Usage: bash .agents/skills/skill-sync/scripts/upstream-changes.test.sh
# Runs upstream-changes.sh against a local repo standing in for GitHub.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT

commit() { # <message>
    git -C "$repo" add -A . && git -C "$repo" -c user.name=t -c user.email=t@t commit --quiet -m "$1"
}

repo="$base/owner/repo.git"
mkdir -p "$repo/pack/skills/demo" "$repo/pack/skills/other"
git -C "$repo" init --quiet
echo a > "$repo/pack/skills/demo/SKILL.md"
echo b > "$repo/pack/skills/other/SKILL.md"
echo 'MIT 2025' > "$repo/pack/LICENSE"
echo 'Root licence' > "$repo/LICENSE"
commit first
first=$(git -C "$repo" rev-parse --short=12 HEAD)

factory="$base/factory"
mkdir -p "$factory"
cat >"$factory/UPSTREAM.md" <<EOF2
| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| \`demo\` | owner/repo | \`pack/skills/demo\` | \`skills/nested/demo\` | \`$first\` | 2026-01-01 |  |

| Port | Source | Path | Sections | Commit | Date |
| ---- | ------ | ---- | -------- | ------ | ---- |
| \`skills/lar-build/agents/doubt.md\` | owner/repo | \`pack/skills/other\` | pack/skills/other/SKILL.md | \`$first\` | 2026-01-01 |
EOF2

fail=0
check() { # <description> <output> <pattern> [absent]
    if grep -qE "$3" <<<"$2"; then found=1; else found=0; fi
    if [[ "${4:-}" == absent ]]; then found=$((1 - found)); fi
    if [[ $found == 1 ]]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
run() { SKILL_SYNC_GIT_BASE="file://$base" bash "$here/upstream-changes.sh" "$factory"; }

out=$(run)
check "reports an unchanged copy" "$out" "^== demo: unchanged \\(owner/repo $first, "
check "reads only the Copies table" "$out" "doubt" absent

echo c > "$repo/pack/skills/other/SKILL.md"
echo 'Root licence, new year' > "$repo/LICENSE"
commit "outside the copy"
out=$(run)
check "ignores changes outside the copy and its licence" "$out" "^== demo: unchanged"

echo 'MIT 2026' > "$repo/pack/LICENSE"
commit "bump licence"
head=$(git -C "$repo" rev-parse --short=12 HEAD)
out=$(run)
check "reports a change to the licence file" "$out" "^== demo: changed \\(owner/repo $first..$head, "
check "logs the licence commit" "$out" "bump licence$"
check "shows the licence diff" "$out" "^\\+MIT 2026$"
check "leaves out commits that touch neither" "$out" "outside the copy" absent

echo d > "$repo/pack/skills/demo/SKILL.md"
commit "edit demo"
out=$(run)
check "still reports a change to the copy" "$out" "edit demo$"

sed -i.bak "s/$first/$(git -C "$repo" rev-parse --short=12 HEAD)/" "$factory/UPSTREAM.md"
echo 'Apache 2.0' > "$repo/pack/skills/LICENSE"
commit "closer licence"
out=$(run)
check "reports a licence that appears closer to the copy" "$out" "^== demo: changed"
check "shows the new licence" "$out" "^\\+Apache 2.0$"

# Override marks, in a second upstream repo.
marks="$base/owner/marks.git"
mkdir -p "$marks/skills/demo" "$marks/refs"
git -C "$marks" init --quiet
cat >"$marks/skills/demo/SKILL.md" <<'EOF2'
# Demo

## Steps

Run the steps.

### Detail

Some detail.

```bash
# not a heading
```

## Showing

Show the work.

## Gone

This heading goes.

## Last

The end.
EOF2
printf '# Notes\n\nNotes.\n' >"$marks/skills/demo/NOTES.md"
printf '# Old\n\nOld.\n' >"$marks/skills/demo/OLD.md"
printf '# Check\n\n## Items\n\nOne.\n' >"$marks/refs/check.md"
repo=$marks commit first
mfirst=$(git -C "$marks" rev-parse --short=12 HEAD)
sed -i.bak -e 's/^Some detail\.$/More detail./' -e '/^## Gone$/,/^This heading goes\.$/d' "$marks/skills/demo/SKILL.md"
rm "$marks/skills/demo/SKILL.md.bak" "$marks/skills/demo/OLD.md"
repo=$marks commit second

factory="$base/marks-factory"
mkdir -p "$factory"
cat >"$factory/UPSTREAM.md" <<EOF2
| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| \`demo\` | owner/marks | \`skills/demo\` | \`skills/nested/demo\` | \`$mfirst\` | 2026-10-01 | SKILL.md#Steps (skills/lar-work/SKILL.md); SKILL.md#Showing (skills/lar-work/agents/planner.md); SKILL.md#Gone (skills/lar-work/SKILL.md); NOTES.md#Notes (skills/lar-work/SKILL.md); OLD.md#Old (skills/lar-work/SKILL.md); SKILL.md#Missing (skills/lar-work/SKILL.md); SKILL.md (skills/lar-work/SKILL.md); NOTES.md (skills/lar-work/SKILL.md) |
| \`references/check.md\` | owner/marks | \`refs/check.md\` | \`skills/nested/references/check.md\` | \`$mfirst\` | 2026-10-01 | check.md#Items (skills/lar-work/SKILL.md) |
| \`plain\` | owner/marks | \`skills/demo\` | \`skills/nested/plain\` | \`$mfirst\` | 2026-10-01 |  |
EOF2

out=$(run)
check "flags a section whose subsection changed" "$out" "^demo: SKILL.md#Steps \\(skills/lar-work/SKILL.md\\): upstream changed this section$"
check "leaves out a section the diff doesn't touch" "$out" "SKILL.md#Showing" absent
check "flags a deleted heading" "$out" "^demo: SKILL.md#Gone \\(skills/lar-work/SKILL.md\\): upstream renamed or deleted this heading$"
check "leaves out an unchanged file" "$out" "NOTES.md#Notes" absent
check "flags a deleted file" "$out" "^demo: OLD.md#Old \\(skills/lar-work/SKILL.md\\): upstream renamed or deleted OLD.md$"
check "flags a heading missing at the recorded commit" "$out" "^demo: SKILL.md#Missing \\(skills/lar-work/SKILL.md\\): no such heading at $mfirst$"
check "flags a whole-file citation whose file changed" "$out" "^demo: SKILL.md \\(skills/lar-work/SKILL.md\\): upstream changed this file$"
check "leaves out a whole-file citation whose file didn't change" "$out" "^demo: NOTES.md " absent
check "leaves out an unchanged single-file Copy" "$out" "check.md#Items" absent
check "leaves out a row with no Overrides" "$out" "^plain:" absent
check "prints the marks under their Copy's header" "$(grep -A1 '^== demo: changed' <<<"$out")" "^demo: SKILL.md#Steps "
check "prints the Copy's diff after its marks" "$(sed -n '/^== demo:/,/^== references/p' <<<"$out" | sed -n '/^diff --git/,$p')" "^demo: " absent
check "says nothing about untouched Overrides when it flags some" "$out" "no Overrides touched" absent

quiet="$base/quiet"
mkdir -p "$quiet"
grep -v '^| .demo. ' "$factory/UPSTREAM.md" >"$quiet/UPSTREAM.md"
out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/upstream-changes.sh" "$quiet")
check "says so when it flags nothing" "$out" "^no Overrides touched$"

bad="$base/bad"
mkdir -p "$bad"
sed -e "s/$mfirst/--output=x/" "$factory/UPSTREAM.md" >"$bad/UPSTREAM.md"
if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/upstream-changes.sh" "$bad" 2>&1); then
    echo "FAIL exits non-zero on a Commit that isn't a sha"; fail=1
else
    check "exits non-zero on a Commit that isn't a sha" "$out" "^demo: Commit '--output=x' is not a hex sha$"
fi

missing="$base/missing"
mkdir -p "$missing"
sed -e "s/$mfirst/deadbeef1234/" "$factory/UPSTREAM.md" >"$missing/UPSTREAM.md"
if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/upstream-changes.sh" "$missing" 2>&1); then
    echo "FAIL exits non-zero on a Commit upstream doesn't have"; fail=1
else
    check "exits non-zero on a Commit upstream doesn't have" "$out" "^demo: Commit deadbeef1234 not found upstream$"
    check "flags nothing for a Commit upstream doesn't have" "$out" "no such file" absent
fi

if out=$(SKILL_SYNC_GIT_BASE="file://$base/nonexistent" bash "$here/upstream-changes.sh" "$factory" 2>"$base/clone.err"); then
    echo "FAIL exits non-zero on a failed clone"; fail=1
else
    check "exits non-zero on a failed clone and prints nothing" "$out" "." absent
    check "says the clone failed and the scan stopped" "$(cat "$base/clone.err")" "^demo: could not clone owner/marks; scan stopped$"
fi

if out=$(bash "$here/upstream-changes.sh" "$marks/refs" 2>&1); then
    echo "FAIL exits non-zero without UPSTREAM.md"; fail=1
else
    check "exits non-zero without UPSTREAM.md" "$out" "^no UPSTREAM.md in "
fi

exit $fail
