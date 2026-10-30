#!/bin/bash
# Usage: upstream-changes.sh <lar-factory checkout>
# Prints three parts, each under its own heading line: "== Copies", "== Ports"
# and "== New skills".
# For every row in UPSTREAM.md's Copies table, prints the upstream log and diff
# of that skill's folder and of its source's licence file (see licence-file.sh, looked up at both
# ends) from the recorded commit to upstream HEAD, with HEAD's 12-character sha
# and its commit date. Under each Copy's header it prints, as
# <name>: <entry>: <reason>, each Override in the row's "Overridden in" column
# that the upstream change touches (see citation_change). Prints
# "no Overrides touched" at the end when it flags none.
# For every row in the Ports table, prints the same header, log and diff for
# each folder in the row's Path, without the licence. Under the header it
# prints, as <port>: <section>: <reason>, each entry in the row's Sections
# that the change touches, and in the diff it puts ">> <section>" above each
# hunk that changes a line of that section (see mark_hunks). Prints
# "no Port sections touched" at the end when it flags none.
# For every source a row uses, prints "== new skills in <source> (<from>..<head>)"
# and each skill folder (a folder holding a SKILL.md) upstream added since that
# source's commit on the "Checked up to" line, leaving out folders a row's Path
# names; or "== new skills in <source>: none (<head>)"; or, when the line has
# no entry for the source, says so and goes on. Exits non-zero on a
# missing UPSTREAM.md, on a Source that isn't <owner>/<repo>, on a Commit that
# isn't a hex sha or that upstream doesn't have, and on a failed clone or git
# command. Clones into a temp folder.
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

# mark_hunks <specs file>
# Copies a git diff from stdin to stdout and puts ">> <citation>" above each
# hunk that changes a line of a cited range. Each specs line is
# <file>\t<start>\t<end>\t<citation>, with <file> relative to the source's
# root. A removed line counts at its own line; an added line counts at the old
# line it follows, as in citation_change.
mark_hunks() {
    awk -v specs="$1" '
        BEGIN {
            while ((getline line < specs) > 0) {
                split(line, f, "\t")
                n++; sf[n] = f[1]; ss[n] = f[2]; se[n] = f[3]; sc[n] = f[4]
            }
        }
        function flush(   i, k) {
            for (i = 1; i <= n; i++) if (hit[i]) print ">> " sc[i]
            for (k = 1; k <= held; k++) print buf[k]
            held = 0; split("", hit)
        }
        function touch(at,   i) {
            for (i = 1; i <= n; i++)
                if (sf[i] == file && at >= ss[i] && at <= se[i]) hit[i] = 1
        }
        /^diff --git / { flush(); header = 1; file = ""; print; next }
        header && /^--- / { file = substr($0, 5); sub(/^a\//, "", file); print; next }
        /^@@ / {
            flush(); header = 0
            # "-a,0" inserts after line a, so its added lines count at a.
            split(substr($2, 2), old, ",")
            cur = (2 in old) && old[2] == 0 ? old[1] + 1 : old[1]
            buf[++held] = $0; next
        }
        held {
            c = substr($0, 1, 1)
            if (c == "-") touch(cur++)
            else if (c == "+") touch(cur - 1)
            else if (c == " ") cur++
            buf[++held] = $0; next
        }
        { print }
        END { flush() }
    '
}

# fetch <name> <source> <commit>
# Checks <source> is <owner>/<repo>, clones it once, checks <commit> is a sha
# upstream has, and sets clone, head and date to the clone's folder and HEAD's
# 12-character sha and date.
fetch() {
    local name=$1 source=$2 commit=$3
    if [[ ! $commit =~ ^[0-9a-f]{7,40}$ ]]; then
        echo "$name: Commit '$commit' is not a hex sha" >&2
        exit 1
    fi
    if [[ ! $source =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ || /$source/ == */../* || /$source/ == */./* ]]; then
        echo "$name: Source '$source' is not <owner>/<repo>" >&2
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
}

# report_header <name> <source> <commit> <path>...
# Prints the row's "== <name>: changed|unchanged" line and sets changed when
# upstream changed any <path> since <commit>.
report_header() {
    local name=$1 source=$2 commit=$3
    shift 3
    changed=$(git -C "$clone" diff --quiet "$commit" HEAD -- "$@" || echo 1)
    if [[ $changed ]]; then
        echo "== $name: changed ($source $commit..$head, $date)"
    else
        echo "== $name: unchanged ($source $head, $date)"
    fi
}

sources=""
tracked=""
flagged=0
echo "== Copies"
# Reads rows in this shell, not a pipeline or $(...), so set -e stops the
# script on a failed clone or git command and the flag count survives the loop.
while IFS='|' read -r _ name source path _ commit _ overrides _; do
    name=$(echo "$name" | tr -d ' `'); source=$(echo "$source" | tr -d ' ')
    path=$(echo "$path" | tr -d ' `'); commit=$(echo "$commit" | tr -d ' `')
    fetch "$name" "$source" "$commit"
    sources+="$source"$'\n'; tracked+="$path"$'\n'
    paths=("$path")
    # The licence file at both ends, so one added or moved upstream shows too.
    for rev in "$commit" HEAD; do
        if licence=$(licence_file "$clone" "$rev" "$path"); then paths+=("$licence"); fi
    done
    report_header "$name" "$source" "$commit" "${paths[@]}"
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

flagged=0
echo "== Ports"
while IFS='|' read -r _ name source path sections commit _; do
    name=$(echo "$name" | tr -d ' `'); source=$(echo "$source" | tr -d ' ')
    commit=$(echo "$commit" | tr -d ' `')
    fetch "$name" "$source" "$commit"
    IFS=';' read -ra paths <<<"$(echo "$path" | tr -d ' `')"
    sources+="$source"$'\n'; tracked+=$(printf '%s\n' "${paths[@]}")$'\n'
    report_header "$name" "$source" "$commit" "${paths[@]}"
    : >"$work/specs"
    while IFS= read -r entry; do
        entry=$(echo "$entry" | sed -e 's/^ *//' -e 's/ *$//')
        [[ -n $entry ]] || continue
        reason=$(citation_change "$clone" "$commit" HEAD "$entry")
        if [[ -n $reason ]]; then
            echo "$name: $entry: $reason"
            flagged=$((flagged + 1))
        fi
        file=${entry%%#*}
        git -C "$clone" cat-file -e "$commit:$file" 2>/dev/null || continue
        if [[ $entry == *"#"* ]]; then
            range=$(git -C "$clone" show "$commit:$file" | section "${entry#*#}")
        else
            range="1 $(git -C "$clone" show "$commit:$file" | wc -l)"
        fi
        if [[ -n $range ]]; then
            printf '%s\t%s\t%s\t%s\n' "$file" "${range% *}" "${range#* }" "$entry" >>"$work/specs"
        fi
    done < <(tr -d '`' <<<"$sections" | tr ';' '\n')
    if [[ $changed ]]; then
        git -C "$clone" log --format='   %h %s' "$commit..HEAD" -- "${paths[@]}"
        git -C "$clone" diff "$commit" HEAD -- "${paths[@]}" | mark_hunks "$work/specs"
    fi
done < <(upstream_rows "$factory/UPSTREAM.md" Ports)

if [[ $flagged == 0 ]]; then echo "no Port sections touched"; fi

# checked_up_to <source>
# Prints the commit the "Checked up to" line holds for <source>, or nothing.
checked_up_to() {
    local entry
    sed -n 's/^Checked up to: //p' "$factory/UPSTREAM.md" | sed 's/\.$//' | tr ',' '\n' |
        while read -r entry; do
            if [[ ${entry%% *} == "$1" ]]; then echo "${entry#* }" | tr -d ' `'; fi
        done
}

# skill_folders <rev>
# Prints each folder holding a SKILL.md at <rev> in $clone, sorted.
skill_folders() {
    git -C "$clone" ls-tree -r --name-only "$1" | sed -n 's|/SKILL\.md$||p' | LC_ALL=C sort
}

echo "== New skills"
while IFS= read -r source; do
    from=$(checked_up_to "$source")
    if [[ -z $from ]]; then
        echo "== new skills in $source: no \"Checked up to\" entry in UPSTREAM.md"
        continue
    fi
    fetch "$source: Checked up to" "$source" "$from"
    added=$(LC_ALL=C comm -13 <(skill_folders "$from") <(skill_folders HEAD) |
        grep -vxF -f <(printf '%s' "$tracked" | grep .) || true)
    if [[ -n $added ]]; then
        echo "== new skills in $source ($from..$head)"
        echo "$added"
    else
        echo "== new skills in $source: none ($head)"
    fi
done < <(printf '%s' "$sources" | awk 'NF && !seen[$0]++')
