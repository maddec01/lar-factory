#!/bin/bash
# Usage: upstream-changes.sh <mux-factory checkout>
# For every row in UPSTREAM.md, prints the upstream log and diff of that skill's
# folder from the recorded commit to upstream HEAD. Clones into a temp folder.
set -euo pipefail

factory=$(cd "${1:-.}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

grep -E '^\| `' "$factory/UPSTREAM.md" | while IFS='|' read -r _ name source path commit _; do
    name=$(echo "$name" | tr -d ' `'); source=$(echo "$source" | tr -d ' ')
    path=$(echo "$path" | tr -d ' `'); commit=$(echo "$commit" | tr -d ' `')
    clone="$work/${source//\//_}"
    [[ -d "$clone" ]] || git clone --quiet "https://github.com/$source.git" "$clone"
    head=$(git -C "$clone" rev-parse --short=12 HEAD)
    if git -C "$clone" diff --quiet "$commit" HEAD -- "$path"; then
        echo "== $name: unchanged ($source $head)"
        continue
    fi
    echo "== $name: changed ($source $commit..$head)"
    git -C "$clone" log --format='   %h %s' "$commit..HEAD" -- "$path"
    git -C "$clone" diff "$commit" HEAD -- "$path"
done
