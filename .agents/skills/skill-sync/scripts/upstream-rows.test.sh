#!/bin/bash
# Usage: bash .agents/skills/skill-sync/scripts/upstream-rows.test.sh
# Runs upstream_rows against an UPSTREAM.md with a Copies table and a Ports table.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=upstream-rows.sh
source "$here/upstream-rows.sh"
base=$(mktemp -d)
trap 'rm -rf "$base"' EXIT

cat >"$base/UPSTREAM.md" <<'EOF2'
# Upstream

| Skill | Source | Path | Repository path | Commit | Date | Overridden in |
| ----- | ------ | ---- | --------------- | ------ | ---- | ------------- |
| `demo` | owner/repo | `skills/demo` | `skills/shared/skills/demo` | `aaaaaaaaaaaa` | 2026-01-01 |  |
| `references/list.md` | owner/repo | `refs/list.md` | `skills/lar-build/references/list.md` | `aaaaaaaaaaaa` | 2026-01-01 |  |

A Port's commit means "upstream reviewed up to here".

| Port | Source | Path | Sections | Commit | Date |
| ---- | ------ | ---- | -------- | ------ | ---- |
| `skills/lar-build/agents/doubt.md` | owner/repo | `skills/doubt` | skills/doubt/SKILL.md#Steps | `bbbbbbbbbbbb` | 2026-01-02 |

| `stray` | a row in no table |
EOF2

fail=0
same() { # <description> <actual> <expected>
    if [[ "$2" == "$3" ]]; then echo "ok   $1"; else echo "FAIL $1"; printf '%s\n' "$2"; fail=1; fi
}

same "prints the Copies table's rows" "$(upstream_rows "$base/UPSTREAM.md" Copies)" "$(grep -E '^\| `(demo|references)' "$base/UPSTREAM.md")"
same "prints the Ports table's rows" "$(upstream_rows "$base/UPSTREAM.md" Ports)" "$(grep -E '^\| `skills/lar-build' "$base/UPSTREAM.md")"
printf '| Skill | Source |\n| ----- | ------ |\n' >"$base/empty.md"
same "prints nothing for a missing table" "$(upstream_rows "$base/empty.md" Ports)" ""
if upstream_rows "$base/UPSTREAM.md" Other 2>/dev/null; then echo "FAIL rejects an unknown table"; fail=1; else echo "ok   rejects an unknown table"; fi

exit $fail
