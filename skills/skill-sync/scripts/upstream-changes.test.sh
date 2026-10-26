#!/bin/bash
# Usage: bash skills/skill-sync/scripts/upstream-changes.test.sh
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
| Skill | Source | Path | Commit | Date | Overridden in |
| ----- | ------ | ---- | ------ | ---- | ------------- |
| \`demo\` | owner/repo | \`pack/skills/demo\` | \`$first\` | 2026-01-01 |  |
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

exit $fail
