#!/bin/bash
# Usage: bash skills/skill-sync/scripts/copy-licences.test.sh
# Runs copy-licences.sh against local repos standing in for GitHub.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT

commit() { # <repo> <message>
    git -C "$1" add . && git -C "$1" -c user.name=t -c user.email=t@t commit --quiet -m "$2"
}

# owner/root keeps its licence at the root, owner/nested below it in pack/,
# and owner/bare has none.
root="$base/owner/root.git" nested="$base/owner/nested.git" bare="$base/owner/bare.git"
mkdir -p "$root/skills/demo" "$root/refs" "$nested/pack/skills/deep" "$bare/skills/plain"
for repo in "$root" "$nested" "$bare"; do
    git -C "$repo" init --quiet && git -C "$repo" config uploadpack.allowFilter true
done
echo a > "$root/skills/demo/SKILL.md"
echo r > "$root/refs/list.md"
printf 'Root licence\r\nno trailing newline' > "$root/LICENSE"
commit "$root" first
old=$(git -C "$root" rev-parse --short=12 HEAD)
echo 'Root licence, new year' > "$root/LICENSE"
commit "$root" second
new=$(git -C "$root" rev-parse --short=12 HEAD)
echo b > "$nested/pack/skills/deep/SKILL.md"
echo 'Nested licence' > "$nested/pack/LICENSE.md"
echo 'Root of nested, not this one' > "$nested/COPYING"
commit "$nested" first
nested_head=$(git -C "$nested" rev-parse --short=12 HEAD)
echo c > "$bare/skills/plain/SKILL.md"
commit "$bare" first
bare_head=$(git -C "$bare" rev-parse --short=12 HEAD)

factory="$base/factory"
mkdir -p "$factory/skills/demo" "$factory/skills/deep" "$factory/skills/plain" "$factory/skills/own" "$factory/references"
echo stale > "$factory/skills/plain/LICENSE"
cat >"$factory/UPSTREAM.md" <<EOF2
| Skill | Source | Path | Commit | Date | Overridden in |
| ----- | ------ | ---- | ------ | ---- | ------------- |
| \`demo\` | owner/root | \`skills/demo\` | \`$old\` | 2026-01-01 |  |
| \`deep\` | owner/nested | \`pack/skills/deep\` | \`$nested_head\` | 2026-01-01 |  |
| \`plain\` | owner/bare | \`skills/plain\` | \`$bare_head\` | 2026-01-01 |  |
| \`references/list.md\` | owner/root | \`refs/list.md\` | \`$old\` | 2026-01-01 |  |
EOF2

fail=0
check() { # <description> <output> <pattern> [absent]
    if grep -qE "$3" <<<"$2"; then found=1; else found=0; fi
    if [[ "${4:-}" == absent ]]; then found=$((1 - found)); fi
    if [[ $found == 1 ]]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
same() { # <description> <file> <repo> <commit:path>
    if cmp -s "$2" <(git -C "$3" cat-file blob "$4"); then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory")
same "copies a root licence byte for byte at the recorded commit" "$factory/skills/demo/LICENSE" "$root" "$old:LICENSE"
same "copies the licence nearest the path, not the root one" "$factory/skills/deep/LICENSE" "$nested" "$nested_head:pack/LICENSE.md"
same "gives references/ its source's licence" "$factory/references/LICENSE" "$root" "$old:LICENSE"
check "reports each licence it writes" "$out" "^wrote skills/demo/LICENSE from owner/root LICENSE$"
check "reports the nested licence's path" "$out" "^wrote skills/deep/LICENSE from owner/nested pack/LICENSE.md$"
check "warns about a source with no licence" "$out" "^no licence: plain \\(owner/bare\\), removed skills/plain/LICENSE$"
if [[ -e "$factory/skills/plain/LICENSE" ]]; then echo "FAIL removes the LICENSE of a source with none"; fail=1; else echo "ok   removes the LICENSE of a source with none"; fi
if [[ -e "$factory/skills/own/LICENSE" ]]; then echo "FAIL leaves folders UPSTREAM.md doesn't list alone"; fail=1; else echo "ok   leaves folders UPSTREAM.md doesn't list alone"; fi

out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory")
check "rewrites nothing on a second run" "$out" "^wrote" absent
check "warns again about a source with no licence" "$out" "^no licence: plain \\(owner/bare\\)$"

sed -i.bak "s/\`$old\`/\`$new\`/" "$factory/UPSTREAM.md" && rm "$factory/UPSTREAM.md.bak"
out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory")
same "follows the commit a take records" "$factory/skills/demo/LICENSE" "$root" "$new:LICENSE"
check "reports the updated licence" "$out" "^wrote skills/demo/LICENSE from owner/root LICENSE$"

# shellcheck disable=SC2016 # the backticks are Markdown
printf '| `gone` | owner/root | `skills/gone` | `%s` | 2026-01-01 |  |\n' "$new" >>"$factory/UPSTREAM.md"
if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory" 2>&1); then
    echo "FAIL exits non-zero when a listed Copy's folder is missing"; fail=1
else
    check "exits non-zero when a listed Copy's folder is missing" "$out" "^gone: no folder skills/gone$"
fi

exit $fail
