#!/bin/bash
# Usage: bash skills/skill-sync/scripts/preview-copy.test.sh
# Runs preview-copy.sh against a local repo standing in for GitHub.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT

repo="$base/owner/repo.git"
mkdir -p "$repo/pack/skills/demo/refs" "$repo/pack/skills/other"
git -C "$repo" init --quiet
git -C "$repo" config uploadpack.allowFilter true
echo a > "$repo/pack/skills/demo/SKILL.md"
echo b > "$repo/pack/skills/demo/refs/notes.md"
echo c > "$repo/pack/skills/other/SKILL.md"
echo MIT > "$repo/pack/LICENSE"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit --quiet -m first
first=$(git -C "$repo" rev-parse HEAD)
echo d > "$repo/pack/skills/demo/new.md"
git -C "$repo" add . && git -C "$repo" -c user.name=t -c user.email=t@t commit --quiet -m second
head=$(git -C "$repo" rev-parse HEAD)

fail=0
check() { # <description> <output> <pattern> [absent]
    if grep -qE "$3" <<<"$2"; then found=1; else found=0; fi
    if [[ "${4:-}" == absent ]]; then found=$((1 - found)); fi
    if [[ $found == 1 ]]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/preview-copy.sh" owner/repo pack/skills/demo/)
check "prints the full HEAD commit" "$out" "^HEAD: $head .* second"
check "copies HEAD by default" "$out" "^Copy: $head .* second"
check "lists the files at the path" "$out" "pack/skills/demo/refs/notes.md"
check "leaves out files outside the path" "$out" "pack/skills/other" absent
check "lists the licence" "$out" "^   pack/LICENSE$"
check "names the licence the Copy gets" "$out" "^LICENSE from: pack/LICENSE$"

out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/preview-copy.sh" owner/repo pack/skills/demo "$first")
check "copies the chosen commit" "$out" "^Copy: $first .* first"
check "lists files at the chosen commit" "$out" "pack/skills/demo/new.md" absent
check "still prints HEAD" "$out" "^HEAD: $head"

if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/preview-copy.sh" owner/repo pack/skills/demo nosuchcommit 2>&1); then
    echo "FAIL exits non-zero for an unknown commit"; fail=1
else
    check "exits non-zero for an unknown commit" "$out" "^unknown commit: nosuchcommit$"
fi

git -C "$repo" rm --quiet pack/LICENSE
git -C "$repo" -c user.name=t -c user.email=t@t commit --quiet -m third
out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/preview-copy.sh" owner/repo pack/skills/demo)
check "says when the Copy gets no licence" "$out" "^LICENSE from: none$"

if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/preview-copy.sh" owner/repo pack/skills/demo --output=x 2>&1); then
    echo "FAIL rejects a commit that looks like an option"; fail=1
else
    check "rejects a commit that looks like an option" "$out" "^unknown commit: --output=x$"
fi

if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/preview-copy.sh" owner/repo pack/skills/missing 2>&1); then
    echo "FAIL exits non-zero for a path with no files"; fail=1
else
    check "exits non-zero for a path with no files" "$out" "^no files at pack/skills/missing$"
fi

if out=$(bash "$here/preview-copy.sh" owner/repo 2>&1); then
    echo "FAIL exits non-zero with fewer than two arguments"; fail=1
else
    check "prints usage with fewer than two arguments" "$out" "^usage: preview-copy.sh <owner/repo> <path> \\[commit\\]$"
fi

exit $fail
