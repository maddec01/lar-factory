#!/bin/bash
# Usage: override-changes.sh <lar-factory checkout>
# For every Override in UPSTREAM.md's "Overridden in" column, prints the Override
# when the upstream diff from the row's commit to upstream HEAD changes a line
# in the cited section, or when upstream renamed or deleted the cited heading or
# file. Prints "no Overrides touched" when it flags none. Exits non-zero on a
# Commit that isn't a hex sha or that upstream doesn't have, and on a failed
# clone or git command. Clones into
# a temp folder without file contents.
# SKILL_SYNC_GIT_BASE overrides https://github.com.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=upstream-rows.sh
source "$here/upstream-rows.sh"
factory=$(cd "${1:-.}" && pwd)
if [[ ! -f "$factory/UPSTREAM.md" ]]; then
    echo "no UPSTREAM.md in $factory" >&2
    exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Prints "<start> <end>" for the section under heading $2 in markdown on stdin:
# the heading's line to the line before the next heading of the same or higher
# level. Skips fenced code blocks. Prints nothing when the heading is missing.
section() {
    awk -v want="$1" '
        /^(```|~~~)/ { fence = !fence; next }
        fence || !/^#{1,6}[ \t]/ { next }
        {
            level = match($0, /[^#]/) - 1
            text = substr($0, level + 1)
            sub(/^[ \t]+/, "", text); sub(/[ \t#]+$/, "", text)
            if (start && level <= startlevel) { print start, NR - 1; found = 1; exit }
            if (!start && text == want) { start = NR; startlevel = level }
        }
        END { if (start && !found) print start, NR }
    '
}

# Prints one flagged Override, <name>: <entry>: <reason>, and counts it.
flagged=0
flag() { echo "$1: $2: $3"; flagged=$((flagged + 1)); }

# Reads rows in this shell, not a pipeline or $(...), so set -e stops the
# script on a failed clone or git command and flag's count survives the loop.
while IFS='|' read -r _ name source path _ commit _ overrides _; do
    name=$(echo "$name" | tr -d ' `'); source=$(echo "$source" | tr -d ' ')
    path=$(echo "$path" | tr -d ' `'); commit=$(echo "$commit" | tr -d ' `')
    [[ -n "${overrides// /}" ]] || continue
    if [[ ! $commit =~ ^[0-9a-f]{7,40}$ ]]; then
        echo "$name: Commit '$commit' is not a hex sha" >&2
        exit 1
    fi
    clone="$work/${source//\//_}"
    if [[ ! -d "$clone" ]] && ! GIT_TERMINAL_PROMPT=0 git clone --quiet --filter=blob:none --no-checkout \
        "${SKILL_SYNC_GIT_BASE:-https://github.com}/$source.git" "$clone"; then
        echo "$name: could not clone $source; scan stopped" >&2
        exit 1
    fi
    if ! git -C "$clone" cat-file -e "$commit^{commit}" 2>/dev/null; then
        echo "$name: Commit $commit not found upstream" >&2
        exit 1
    fi
    is_file=$([[ $(git -C "$clone" cat-file -t "$commit:$path" 2>/dev/null) == blob ]] && echo 1 || true)
    while IFS= read -r entry; do
        entry=$(echo "$entry" | sed -e 's/^ *//' -e 's/ *$//')
        [[ -n $entry ]] || continue
        cited=${entry%%#*} rest=${entry#*#}
        heading=${rest% (*}
        if [[ $is_file ]]; then file=$path; else file=$path/$cited; fi
        if ! old=$(git -C "$clone" show "$commit:$file" 2>/dev/null); then
            flag "$name" "$entry" "no such file at $commit"
            continue
        fi
        range=$(section "$heading" <<<"$old")
        if [[ -z $range ]]; then
            flag "$name" "$entry" "no such heading at $commit"
            continue
        fi
        if ! new=$(git -C "$clone" show "HEAD:$file" 2>/dev/null); then
            flag "$name" "$entry" "upstream renamed or deleted $cited"
            continue
        fi
        if [[ -z $(section "$heading" <<<"$new") ]]; then
            flag "$name" "$entry" "upstream renamed or deleted this heading"
            continue
        fi
        read -r start end <<<"$range"
        diff=$(git -C "$clone" diff -U0 "$commit" HEAD -- "$file")
        # A hunk "-a,b" changes old lines a..a+b-1; with b=0 it inserts after line a.
        if awk -v s="$start" -v e="$end" '
            /^@@ / {
                split(substr($2, 2), old, ",")
                a = old[1]; b = (2 in old) ? old[2] : 1
                last = b ? a + b - 1 : a
                if (a <= e && last >= s) hit = 1
            }
            END { exit !hit }
        ' <<<"$diff"; then
            flag "$name" "$entry" "upstream changed this section"
        fi
    done < <(tr ';' '\n' <<<"$overrides")
done < <(upstream_rows "$factory/UPSTREAM.md" Copies)

if [[ $flagged == 0 ]]; then echo "no Overrides touched"; fi
