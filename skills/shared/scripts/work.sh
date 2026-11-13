#!/bin/bash
# Usage: work.sh <work ID | ticket>
# Prints the work record <ref> names, as lar-work read prints it, so a factory thread
# resolves its argument. status.sh and slice.sh source it for work_record <ref>, which
# does the same. <ref> is a work ID or a picked ticket:
# owner/repo#12, its GitHub issue URL, or an Azure work item URL. A ticket that no
# record holds fails with how to pick it on the board. lar-work opens the
# work-record database directly, so this works while the board app is closed.
# Each failure prints its reason on stderr and returns nonzero.

# shellcheck source-path=SCRIPTDIR source=azure.sh
source "$(dirname "${BASH_SOURCE[0]}")/azure.sh"

# Prefer the CLI belonging to these scripts, including assembled skills nested in
# the checkout. Never choose another checkout from the caller's working directory.
# Installed skills have no checkout ancestor and keep using the app's launcher.
work_cli() {
    local dir cli data_dir="$HOME/Library/Application Support/Lar Factory"
    dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P) || return 1
    while :; do
        if [[ -d $dir/packages/work-records ]]; then
            cli="$dir/packages/work-records/src/cli.ts"
            if [[ ! -f $cli || ! -r $cli ]]; then
                echo "Can't read the checkout CLI at $cli. Restore the factory checkout and run bash scripts/setup-worktree.sh, then rerun." >&2
                return 1
            fi
            if ! command -v node >/dev/null || ! node -e '
                const [major, minor] = process.versions.node.split(".").map(Number);
                process.exit(major > 24 || (major === 24 && minor >= 15) ? 0 : 1);
            ' 2>/dev/null; then
                echo "The checkout CLI needs Node >=24.15 on PATH. Install a supported Node, then run bash scripts/setup-worktree.sh in $dir and rerun." >&2
                return 1
            fi
            [[ ${LAR_FACTORY_DATA_DIR:-} != /* ]] || data_dir=$LAR_FACTORY_DATA_DIR
            LAR_FACTORY_DATA_DIR="$data_dir" node --disable-warning=ExperimentalWarning "$cli" "$@" --data-dir "$data_dir"
            return
        fi
        [[ $dir != / ]] || break
        dir=$(dirname "$dir")
    done
    if command -v lar-work >/dev/null; then
        lar-work "$@"
        return
    fi
    echo "lar-work isn't on PATH and these scripts have no checkout CLI. Run from a factory checkout with packages/work-records/src/cli.ts (Node >=24.15; bash scripts/setup-worktree.sh), or open the Lar Factory app once to install lar-work in ~/.local/bin and add it to PATH, then rerun." >&2
    return 1
}

work_record() {
    local ref=$1 ticket prefix="" records record
    if [[ $ref =~ ^https://github\.com/([^/]+/[^/]+)/issues/([0-9]+)$ ]]; then
        ticket="${BASH_REMATCH[1]}#${BASH_REMATCH[2]}"
    elif [[ $ref =~ ^[^/#[:space:]]+(/[^/#[:space:]]+)+#[0-9]+$ ]]; then
        ticket=$ref
    elif azure_work_item "$ref"; then
        # An Azure ticket is <org>/<project>/<repo>#<id>, and the URL doesn't name the repository.
        ticket=$ref prefix="${az_org##*/}/$az_project/"
    else
        work_cli read "$ref"
        return
    fi
    records=$(work_cli list) || return 1
    record=$(jq --arg ticket "$ticket" --arg prefix "$prefix" --arg id "${az_id:-}" 'first(.[] | select(.ticket != null and
        if $prefix == "" then .ticket == $ticket
        else (.ticket | split("#")) as [$repo, $n] | $n == $id and ($repo | startswith($prefix))
            and ($repo | ltrimstr($prefix) | contains("/") | not) end)) // empty' <<<"$records")
    if [[ -z $record ]]; then
        echo "$ticket has no work record. Pick the ticket on the board, then rerun." >&2
        return 1
    fi
    echo "$record"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
    set -euo pipefail
    work_record "${1:?usage: work.sh <work ID | owner/repo#n | issue or Azure work item URL>}"
fi
