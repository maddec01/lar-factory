#!/bin/bash
# Usage: bash .agents/skills/skill-sync/scripts/copy-licences.test.sh
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
mkdir -p "$factory/skills/nested/demo" "$factory/skills/nested/deep" "$factory/skills/nested/plain" "$factory/skills/nested/own" "$factory/skills/nested/references" "$factory/skills/nested/port/agents"
echo r > "$factory/skills/nested/references/list.md"
echo p > "$factory/skills/nested/port/agents/doubt.md"
echo kept > "$factory/skills/nested/port/agents/LICENSE"

echo stale > "$factory/skills/nested/plain/LICENSE"
cat >"$factory/UPSTREAM.md" <<EOF2
| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| \`demo\` | owner/root | \`skills/demo\` | \`skills/nested/demo\` | \`$old\` | 2026-01-01 |  |
| \`deep\` | owner/nested | \`pack/skills/deep\` | \`skills/nested/deep\` | \`$nested_head\` | 2026-01-01 |  |
| \`plain\` | owner/bare | \`skills/plain\` | \`skills/nested/plain\` | \`$bare_head\` | 2026-01-01 |  |
| \`references/list.md\` | owner/root | \`refs/list.md\` | \`skills/nested/references/list.md\` | \`$old\` | 2026-01-01 |  |

Ports follow upstream up to the commit last reviewed.

| Port | Source | Path | Sections | Commit | Date |
| ---- | ------ | ---- | -------- | ------ | ---- |
| \`skills/nested/port/agents/doubt.md\` | owner/root | \`skills/demo\` | skills/demo/SKILL.md#Steps | \`$old\` | 2026-01-01 |
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
same "copies a root licence byte for byte at the recorded commit" "$factory/skills/nested/demo/LICENSE" "$root" "$old:LICENSE"
same "copies the licence nearest the path, not the root one" "$factory/skills/nested/deep/LICENSE" "$nested" "$nested_head:pack/LICENSE.md"
same "gives references/ its source's licence" "$factory/skills/nested/references/LICENSE" "$root" "$old:LICENSE"
check "reports each licence it writes" "$out" "^wrote skills/nested/demo/LICENSE from owner/root LICENSE$"
check "reports the nested licence's path" "$out" "^wrote skills/nested/deep/LICENSE from owner/nested pack/LICENSE.md$"
check "warns about a source with no licence" "$out" "^no licence: plain \\(owner/bare\\), removed skills/nested/plain/LICENSE$"
if [[ -e "$factory/skills/nested/plain/LICENSE" ]]; then echo "FAIL removes the LICENSE of a source with none"; fail=1; else echo "ok   removes the LICENSE of a source with none"; fi
check "leaves Port rows out of its report" "$out" "port|doubt" absent
if [[ "$(cat "$factory/skills/nested/port/agents/LICENSE")" == kept ]]; then echo "ok   leaves a LICENSE beside a Port alone"; else echo "FAIL leaves a LICENSE beside a Port alone"; fail=1; fi
if [[ -e "$factory/skills/nested/port/LICENSE" ]]; then echo "FAIL writes no LICENSE for a Port"; fail=1; else echo "ok   writes no LICENSE for a Port"; fi
if [[ -e "$factory/skills/nested/own/LICENSE" ]]; then echo "FAIL leaves folders UPSTREAM.md doesn't list alone"; fail=1; else echo "ok   leaves folders UPSTREAM.md doesn't list alone"; fi

out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory")
check "rewrites nothing on a second run" "$out" "^wrote" absent
check "warns again about a source with no licence" "$out" "^no licence: plain \\(owner/bare\\)$"

sed -i.bak "s/\`$old\`/\`$new\`/" "$factory/UPSTREAM.md" && rm "$factory/UPSTREAM.md.bak"
out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory")
same "follows the commit a take records" "$factory/skills/nested/demo/LICENSE" "$root" "$new:LICENSE"
check "reports the updated licence" "$out" "^wrote skills/nested/demo/LICENSE from owner/root LICENSE$"

# Into the Copies table, above the Ports table.
sed -i.bak "/^| \`references\/list.md\` /a\\
| \`gone\` | owner/root | \`skills/gone\` | \`skills/nested/gone\` | \`$new\` | 2026-01-01 |  |
" "$factory/UPSTREAM.md" && rm "$factory/UPSTREAM.md.bak"
if out=$(SKILL_SYNC_GIT_BASE="file://$base" bash "$here/copy-licences.sh" "$factory" 2>&1); then
    echo "FAIL exits non-zero when a listed Copy's folder is missing"; fail=1
else
    check "exits non-zero when a listed Copy's folder is missing" "$out" "^gone: no folder skills/nested/gone$"
fi

exit $fail
