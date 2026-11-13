#!/bin/bash
# Usage: slice.sh <parent> <title> <body-file> [--kind decision|build --repository R]
#          [--blocked-by <work>]...
# Explicit --kind creates a Queued concept or linked-work delivery part atomically
# in the named repository. Without --kind, buildable work gets a private slice
# in its own repository. References are work IDs or picked tickets, as in work.sh.
# Ask running boards to read the parent after success. Creates no tracker content.
set -euo pipefail

usage="usage: slice.sh <parent> <title> <body-file> [--kind decision|build --repository R] [--blocked-by <work>]..."
parent_ref=${1:?$usage}
title=${2:?$usage}
body=${3:?$usage}
shift 3
kind="" repository="" blocker_refs=()
while (($#)); do
    case $1 in
    --kind) kind=${2:?$usage} ;;
    --repository) repository=${2:?$usage} ;;
    --blocked-by) blocker_refs+=("${2:?$usage}") ;;
    *) echo "$usage" >&2; exit 2 ;;
    esac
    shift 2
done

# shellcheck source-path=SCRIPTDIR source=boards.sh
source "$(dirname "$0")/boards.sh"
# shellcheck source-path=SCRIPTDIR source=work.sh
source "$(dirname "$0")/work.sh"
if [[ ! -r $body ]]; then
    echo "slice.sh: can't read $body." >&2
    exit 1
fi
parent=$(work_record "$parent_ref")
parent_id=$(jq -r .workId <<<"$parent")
case $(jq -r .kind <<<"$parent") in
bug|feature|improvement|issue|build)
    kind=${kind:-slice} ;;
concept)
    if [[ $kind != decision && $kind != build ]]; then
        echo "slice.sh: under a concept, --kind names decision or build." >&2
        exit 1
    fi ;;
*)
    echo "slice.sh: $parent_ref is a $(jq -r .kind <<<"$parent"); only buildable work or a concept owns work." >&2
    exit 1 ;;
esac
if [[ $kind == slice ]]; then
    parent_repository=$(jq -r .repository <<<"$parent")
    if [[ -n $repository && $repository != "$parent_repository" ]]; then
        echo "slice.sh: a private slice must use its parent's repository." >&2
        exit 1
    fi
    repository=$parent_repository
elif [[ $kind != build && $kind != decision ]]; then
    echo "slice.sh: --kind names decision or build for delivery parts." >&2
    exit 1
elif [[ -z $repository ]]; then
    echo "slice.sh: a delivery part needs --repository owner/name." >&2
    exit 1
fi
# Resolve every blocker before writing, so an unpicked one leaves nothing made.
blocker_ids=()
for ref in ${blocker_refs[@]+"${blocker_refs[@]}"}; do
    blocker=$(work_record "$ref")
    blocker_ids+=("$(jq -r .workId <<<"$blocker")")
done

if [[ $kind != slice ]]; then
    args=(create-part --parent "$parent_id" --revision "$(jq -r .revision <<<"$parent")"
        --title "$title" --repository "$repository" --kind "$kind" --file "$body")
    for blocker_id in ${blocker_ids[@]+"${blocker_ids[@]}"}; do args+=(--blocked-by "$blocker_id"); done
    record=$(work_cli "${args[@]}")
    work_id=$(jq -r .workId <<<"$record")
else
    record=$(work_cli create --title "$title" --repository "$repository" --kind "$kind")
    work_id=$(jq -r .workId <<<"$record")
    # step <lar-work args>: runs a change to the new record, keeping its latest revision in $record. A failure names the
    # record made so far, which the caller finishes with lar-work or sets aside.
    step() {
        if ! record=$(work_cli "$1" "$work_id" --revision "$(jq -r .revision <<<"$record")" "${@:2}"); then
            echo "slice.sh: made $work_id, but couldn't $1 it. Finish it with lar-work or set it aside." >&2
            exit 1
        fi
    }
    step set-body --body brief --file "$body"
    step set-parent --parent "$parent_id"
    for blocker_id in ${blocker_ids[@]+"${blocker_ids[@]}"}; do step add-blocker --blocker "$blocker_id"; done
fi

echo "$work_id"
ask_boards_to_read "$parent_id"
