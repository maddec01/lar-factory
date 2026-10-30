#!/bin/bash
# Usage: bash .agents/skills/skill-sync/scripts/override-changes.test.sh
# Runs override-changes.sh against a local repo standing in for GitHub.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT

repo="$base/owner/repo.git"
mkdir -p "$repo/skills/demo" "$repo/refs"
git -C "$repo" init --quiet
git -C "$repo" config uploadpack.allowFilter true
cat >"$repo/skills/demo/SKILL.md" <<'EOF'
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
EOF
printf '# Notes\n\nNotes.\n' >"$repo/skills/demo/NOTES.md"
printf '# Old\n\nOld.\n' >"$repo/skills/demo/OLD.md"
printf '# Check\n\n## Items\n\nOne.\n' >"$repo/refs/check.md"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit --quiet -m first
first=$(git -C "$repo" rev-parse --short=12 HEAD)
sed -i.bak -e 's/^Some detail\.$/More detail./' -e '/^## Gone$/,/^This heading goes\.$/d' "$repo/skills/demo/SKILL.md"
rm "$repo/skills/demo/SKILL.md.bak" "$repo/skills/demo/OLD.md"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit --quiet -m second

factory="$base/factory"
mkdir -p "$factory"
cat >"$factory/UPSTREAM.md" <<EOF
| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| \`demo\` | owner/repo | \`skills/demo\` | \`skills/nested/demo\` | \`$first\` | 2026-10-01 | SKILL.md#Steps (skills/lar-work/SKILL.md); SKILL.md#Showing (skills/lar-work/agents/planner.md); SKILL.md#Gone (skills/lar-work/SKILL.md); NOTES.md#Notes (skills/lar-work/SKILL.md); OLD.md#Old (skills/lar-work/SKILL.md); SKILL.md#Missing (skills/lar-work/SKILL.md) |
| \`references/check.md\` | owner/repo | \`refs/check.md\` | \`skills/nested/references/check.md\` | \`$first\` | 2026-10-01 | check.md#Items (skills/lar-work/SKILL.md) |
| \`plain\` | owner/repo | \`skills/demo\` | \`skills/nested/plain\` | \`$first\` | 2026-10-01 |  |
EOF

fail=0
check() { # <description> <output> <pattern> [absent]
    if grep -qE "$3" <<<"$2"; then found=1; else found=0; fi
    if [[ "${4:-}" == absent ]]; then found=$((1 - found)); fi
    if [[ $found == 1 ]]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/override-changes.sh" "$factory")
check "flags a section whose subsection changed" "$out" "^demo: SKILL.md#Steps \(skills/lar-work/SKILL.md\): upstream changed this section$"
check "leaves out a section the diff doesn't touch" "$out" "SKILL.md#Showing" absent
check "flags a deleted heading" "$out" "^demo: SKILL.md#Gone \(skills/lar-work/SKILL.md\): upstream renamed or deleted this heading$"
check "leaves out an unchanged file" "$out" "NOTES.md#Notes" absent
check "flags a deleted file" "$out" "^demo: OLD.md#Old \(skills/lar-work/SKILL.md\): upstream renamed or deleted OLD.md$"
check "flags a heading missing at the recorded commit" "$out" "^demo: SKILL.md#Missing \(skills/lar-work/SKILL.md\): no such heading at $first$"
check "leaves out an unchanged single-file Copy" "$out" "check.md#Items" absent
check "leaves out a row with no Overrides" "$out" "^plain:" absent

quiet="$base/quiet"
mkdir -p "$quiet"
grep -v '^| .demo. ' "$factory/UPSTREAM.md" >"$quiet/UPSTREAM.md"
out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/override-changes.sh" "$quiet")
check "says so when it flags nothing" "$out" "^no Overrides touched$"

bad="$base/bad"
mkdir -p "$bad"
sed -e "s/$first/--output=x/" "$factory/UPSTREAM.md" >"$bad/UPSTREAM.md"
if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/override-changes.sh" "$bad" 2>&1); then
    echo "FAIL exits non-zero on a Commit that isn't a sha"; fail=1
else
    check "exits non-zero on a Commit that isn't a sha" "$out" "^demo: Commit '--output=x' is not a hex sha$"
fi

missing="$base/missing"
mkdir -p "$missing"
sed -e "s/$first/deadbeef1234/" "$factory/UPSTREAM.md" >"$missing/UPSTREAM.md"
if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/override-changes.sh" "$missing" 2>&1); then
    echo "FAIL exits non-zero on a Commit upstream doesn't have"; fail=1
else
    check "exits non-zero on a Commit upstream doesn't have" "$out" "^demo: Commit deadbeef1234 not found upstream$"
    check "flags nothing for a Commit upstream doesn't have" "$out" "no such file" absent
fi

if out=$(SKILL_SYNC_GIT_BASE="file://$base/nonexistent" bash "$here/override-changes.sh" "$factory" 2>"$base/clone.err"); then
    echo "FAIL exits non-zero on a failed clone"; fail=1
else
    check "exits non-zero on a failed clone and prints no flags" "$out" "." absent
    check "says the clone failed and the scan stopped" "$(cat "$base/clone.err")" "^demo: could not clone owner/repo; scan stopped$"
fi

if out=$(bash "$here/override-changes.sh" "$repo/refs" 2>&1); then
    echo "FAIL exits non-zero without UPSTREAM.md"; fail=1
else
    check "exits non-zero without UPSTREAM.md" "$out" "^no UPSTREAM.md in "
fi

exit $fail
