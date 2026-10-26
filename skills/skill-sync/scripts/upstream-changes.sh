#!/bin/bash
# Usage: upstream-changes.sh <lar-factory checkout>
# For every row in UPSTREAM.md, prints the upstream log and diff of that skill's
# folder from the recorded commit to upstream HEAD, with HEAD's 12-character
# sha and its commit date. Exits non-zero on a Commit that isn't a hex sha.
# Clones into a temp folder.
# SKILL_SYNC_GIT_BASE overrides https://github.com.
set -euo pipefail

factory=$(cd "${1:-.}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

grep -E '^\| `' "$factory/UPSTREAM.md" | while IFS='|' read -r _ name source path commit _; do
    name=$(echo "$name" | tr -d ' `'); source=$(echo "$source" | tr -d ' ')
    path=$(echo "$path" | tr -d ' `'); commit=$(echo "$commit" | tr -d ' `')
    if [[ ! $commit =~ ^[0-9a-f]{7,40}$ ]]; then
        echo "$name: Commit '$commit' is not a hex sha" >&2
        exit 1
    fi
    clone="$work/${source//\//_}"
    [[ -d "$clone" ]] || git clone --quiet "${SKILL_SYNC_GIT_BASE:-https://github.com}/$source.git" "$clone"
    head=$(git -C "$clone" rev-parse --short=12 HEAD)
    date=$(git -C "$clone" log -1 --format=%cs HEAD)
    if git -C "$clone" diff --quiet "$commit" HEAD -- "$path"; then
        echo "== $name: unchanged ($source $head, $date)"
        continue
    fi
    echo "== $name: changed ($source $commit..$head, $date)"
    git -C "$clone" log --format='   %h %s' "$commit..HEAD" -- "$path"
    git -C "$clone" diff "$commit" HEAD -- "$path"
done
