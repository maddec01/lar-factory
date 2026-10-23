#!/bin/bash
# Usage: preview-copy.sh <owner/repo> <path> [commit]
# Before adding a copy: prints the source's HEAD commit, the commit to copy
# (HEAD by default), the files at <path> in that commit and the source's licence
# files. Exits non-zero for an unknown commit or a path with no files.
# Clones into a temp folder without file contents. SKILL_SYNC_GIT_BASE overrides https://github.com.
set -euo pipefail

if (($# < 2)); then
    echo "usage: preview-copy.sh <owner/repo> <path> [commit]" >&2
    exit 2
fi
source=$1 path=${2%/} commit=${3:-HEAD}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

GIT_TERMINAL_PROMPT=0 git clone --quiet --filter=blob:none --no-checkout \
    "${SKILL_SYNC_GIT_BASE:-https://github.com}/$source.git" "$work/clone"
cd "$work/clone"
if ! commit=$(git rev-parse --quiet --verify --end-of-options "$commit^{commit}"); then
    echo "unknown commit: ${3:-HEAD}" >&2
    exit 1
fi
files=$(git ls-tree -r --name-only --end-of-options "$commit" -- "$path")
if [[ -z $files ]]; then
    echo "no files at $path" >&2
    exit 1
fi
echo "HEAD: $(git log -1 --format='%H %cs %s' HEAD)"
echo "Copy: $(git log -1 --format='%H %cs %s' --end-of-options "$commit")"
echo "Files at $path:"
sed 's/^/   /' <<<"$files"
echo "Licence files:"
git ls-tree -r --name-only --end-of-options "$commit" | grep -iE '(^|/)(LICEN[CS]E|COPYING)[^/]*$' | sed 's/^/   /' || echo "   none"
