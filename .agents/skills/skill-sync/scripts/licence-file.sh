#!/bin/bash
# Sourced by skill-sync's scripts. Holds the one rule that picks a Copy's licence.

# licence_file <clone> <commit> <path>
# Prints the source's licence file for the Copy at <path>: the first licence
# file, in name order, in the nearest folder from <path> (or a file's own
# folder) up to the repo root. A licence file is a file named LICENSE, LICENCE
# or COPYING, in any case, with any suffix. Returns 1 when the source has none.
licence_file() {
    local clone=$1 commit=$2 dir=$3 found
    [[ $(git -C "$clone" cat-file -t "$commit:$dir" 2>/dev/null) == tree ]] || dir=$(dirname "$dir")
    while true; do
        [[ $dir == . ]] && dir=
        found=$(git -C "$clone" ls-tree "$commit" ${dir:+-- "$dir/"} |
            awk -F '\t' '$1 ~ / blob / { print $2 }' |
            grep -iE '(^|/)(LICEN[CS]E|COPYING)[^/]*$' | LC_ALL=C sort | head -n 1) || true
        if [[ -n $found ]]; then
            echo "$found"
            return 0
        fi
        [[ -z $dir ]] && return 1
        dir=$(dirname "$dir")
    done
}
