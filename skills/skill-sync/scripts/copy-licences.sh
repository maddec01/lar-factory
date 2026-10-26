#!/bin/bash
# Usage: copy-licences.sh <lar-factory checkout>
# For every row in UPSTREAM.md, writes the source's licence file (see
# licence-file.sh) at the row's commit, byte for byte, to LICENSE in the Copy's
# folder: skills/<name>, or the folder of a single-file Copy such as references/.
# Prints each LICENSE it writes or removes, and warns about each source with no
# licence file, whose Copy gets no LICENSE. Exits non-zero on a Commit that
# isn't a hex sha or a Copy whose folder is missing.
# Clones into a temp folder without file contents. SKILL_SYNC_GIT_BASE overrides https://github.com.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=licence-file.sh
source "$here/licence-file.sh"
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
    if [[ $name == */* ]]; then folder=$(dirname "$name"); else folder="skills/$name"; fi
    if [[ ! -d "$factory/$folder" ]]; then
        echo "$name: no folder $folder" >&2
        exit 1
    fi
    clone="$work/${source//\//_}"
    [[ -d "$clone" ]] || GIT_TERMINAL_PROMPT=0 git clone --quiet --filter=blob:none --no-checkout \
        "${SKILL_SYNC_GIT_BASE:-https://github.com}/$source.git" "$clone"
    target="$factory/$folder/LICENSE"
    if ! licence=$(licence_file "$clone" "$commit" "$path"); then
        if [[ -e $target ]]; then
            rm "$target"
            echo "no licence: $name ($source), removed $folder/LICENSE"
        else
            echo "no licence: $name ($source)"
        fi
        continue
    fi
    git -C "$clone" cat-file blob "$commit:$licence" >"$work/licence"
    if ! cmp -s "$work/licence" "$target"; then
        cp "$work/licence" "$target"
        echo "wrote $folder/LICENSE from $source $licence"
    fi
done
