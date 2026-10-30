#!/bin/bash
# Usage: upstream-changes.sh <lar-factory checkout>
# For every row in UPSTREAM.md's Copies table, prints the upstream log and diff
# of that skill's folder and of its source's licence file (see licence-file.sh, looked up at both
# ends) from the recorded commit to upstream HEAD, with HEAD's 12-character sha
# and its commit date. Under each Copy's header it prints, as
# <name>: <entry>: <reason>, each Override in the row's "Overridden in" column
# that the upstream change touches (see citation_change). Prints
# "no Overrides touched" at the end when it flags none. Exits non-zero on a
# missing UPSTREAM.md, on a Commit that isn't a hex sha or that upstream doesn't
# have, and on a failed clone or git command. Clones into a temp folder.
# SKILL_SYNC_GIT_BASE overrides https://github.com.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=licence-file.sh
source "$here/licence-file.sh"
# shellcheck source-path=SCRIPTDIR source=upstream-rows.sh
source "$here/upstream-rows.sh"
factory=$(cd "${1:-.}" && pwd)
if [[ ! -f "$factory/UPSTREAM.md" ]]; then
    echo "no UPSTREAM.md in $factory" >&2
    exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Prints "<start> <end>" for the section under heading $1 in markdown on stdin:
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

# citation_change <clone> <old> <new> <citation> [<root>]
# Prints why the upstream change from commit <old> to <new> touches <citation>,
# a <file>#<heading> or a whole <file>, or prints nothing when it doesn't touch
# it. <file> is relative to the folder <root>, or to the source's root when
# <root> is empty; when <root> is a file at <old>, the citation names that file.
# Returns non-zero on a failed git command.
citation_change() {
    local clone=$1 old=$2 new=$3 citation=$4 root=${5:-}
    local cited=${citation%%#*} heading="" file before range diff status=0
    if [[ $citation == *"#"* ]]; then heading=${citation#*#}; fi
    if [[ -z $root ]]; then
        file=$cited
    elif [[ $(git -C "$clone" cat-file -t "$old:$root" 2>/dev/null) == blob ]]; then
        file=$root
    else
        file=$root/$cited
    fi
    if ! before=$(git -C "$clone" show "$old:$file" 2>/dev/null); then
        echo "no such file at $old"
        return
    fi
    if [[ -n $heading ]]; then
        range=$(section "$heading" <<<"$before")
        if [[ -z $range ]]; then
            echo "no such heading at $old"
            return
        fi
    fi
    if ! git -C "$clone" cat-file -e "$new:$file" 2>/dev/null; then
        echo "upstream renamed or deleted $cited"
        return
    fi
    if [[ -z $heading ]]; then
        git -C "$clone" diff --quiet "$old" "$new" -- "$file" || status=$?
        case $status in
            0) ;;
            1) echo "upstream changed this file" ;;
            *) return 1 ;;
        esac
        return
    fi
    if [[ -z $(git -C "$clone" show "$new:$file" | section "$heading") ]]; then
        echo "upstream renamed or deleted this heading"
        return
    fi
    diff=$(git -C "$clone" diff -U0 "$old" "$new" -- "$file") || return 1
    # A hunk "-a,b" changes old lines a..a+b-1; with b=0 it inserts after line a.
    if awk -v range="$range" '
        BEGIN { split(range, r, " "); s = r[1]; e = r[2] }
        /^@@ / {
            split(substr($2, 2), old, ",")
            a = old[1]; b = (2 in old) ? old[2] : 1
            last = b ? a + b - 1 : a
            if (a <= e && last >= s) hit = 1
        }
        END { exit !hit }
    ' <<<"$diff"; then
        echo "upstream changed this section"
    fi
}

flagged=0
# Reads rows in this shell, not a pipeline or $(...), so set -e stops the
# script on a failed clone or git command and the flag count survives the loop.
while IFS='|' read -r _ name source path _ commit _ overrides _; do
    name=$(echo "$name" | tr -d ' `'); source=$(echo "$source" | tr -d ' ')
    path=$(echo "$path" | tr -d ' `'); commit=$(echo "$commit" | tr -d ' `')
    if [[ ! $commit =~ ^[0-9a-f]{7,40}$ ]]; then
        echo "$name: Commit '$commit' is not a hex sha" >&2
        exit 1
    fi
    clone="$work/${source//\//_}"
    if [[ ! -d "$clone" ]] && ! GIT_TERMINAL_PROMPT=0 git clone --quiet \
        "${SKILL_SYNC_GIT_BASE:-https://github.com}/$source.git" "$clone"; then
        echo "$name: could not clone $source; scan stopped" >&2
        exit 1
    fi
    if ! git -C "$clone" cat-file -e "$commit^{commit}" 2>/dev/null; then
        echo "$name: Commit $commit not found upstream" >&2
        exit 1
    fi
    head=$(git -C "$clone" rev-parse --short=12 HEAD)
    date=$(git -C "$clone" log -1 --format=%cs HEAD)
    paths=("$path")
    # The licence file at both ends, so one added or moved upstream shows too.
    for rev in "$commit" HEAD; do
        if licence=$(licence_file "$clone" "$rev" "$path"); then paths+=("$licence"); fi
    done
    changed=$(git -C "$clone" diff --quiet "$commit" HEAD -- "${paths[@]}" || echo 1)
    if [[ $changed ]]; then
        echo "== $name: changed ($source $commit..$head, $date)"
    else
        echo "== $name: unchanged ($source $head, $date)"
    fi
    while IFS= read -r entry; do
        entry=$(echo "$entry" | sed -e 's/^ *//' -e 's/ *$//')
        [[ -n $entry ]] || continue
        reason=$(citation_change "$clone" "$commit" HEAD "${entry% (*}" "$path")
        if [[ -n $reason ]]; then
            echo "$name: $entry: $reason"
            flagged=$((flagged + 1))
        fi
    done < <(tr ';' '\n' <<<"$overrides")
    if [[ $changed ]]; then
        git -C "$clone" log --format='   %h %s' "$commit..HEAD" -- "${paths[@]}"
        git -C "$clone" diff "$commit" HEAD -- "${paths[@]}"
    fi
done < <(upstream_rows "$factory/UPSTREAM.md" Copies)

if [[ $flagged == 0 ]]; then echo "no Overrides touched"; fi
