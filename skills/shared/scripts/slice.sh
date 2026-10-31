#!/bin/bash
# Usage: slice.sh <parent> <title> <body-file> [--kind decision|build] [--blocked-by <work>]...
# Creates a private work record under <parent> through lar-work and prints its work
# ID. It creates no ticket, label, tag or comment. <parent> and each <work> are a
# work ID or a picked ticket, as work.sh takes them. Under a build the record is a
# slice; under a concept --kind names a decision or a build. The record takes the
# parent's repository, the markdown in <body-file> as its brief (a decision's as its
# decision text), and a blocker edge to each --blocked-by record.
# Once the record is made, it asks each running local board to read the parent, as
# boards.sh says, so the new record shows on the parent's card.
set -euo pipefail

usage="usage: slice.sh <parent> <title> <body-file> [--kind decision|build] [--blocked-by <work>]..."
parent_ref=${1:?$usage}
title=${2:?$usage}
body=${3:?$usage}
shift 3
kind="" blocker_refs=()
while (($#)); do
    case $1 in
    --kind) kind=${2:?$usage} ;;
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
build)
    if [[ -n $kind && $kind != slice ]]; then
        echo "slice.sh: a build owns only slices, so it takes no --kind $kind." >&2
        exit 1
    fi
    kind=slice ;;
concept)
    if [[ $kind != decision && $kind != build ]]; then
        echo "slice.sh: under a concept, --kind names decision or build." >&2
        exit 1
    fi ;;
*)
    echo "slice.sh: $parent_ref is a $(jq -r .kind <<<"$parent"); only a build or a concept owns work." >&2
    exit 1 ;;
esac
# Resolve every blocker before writing, so an unpicked one leaves nothing made.
blocker_ids=()
for ref in ${blocker_refs[@]+"${blocker_refs[@]}"}; do
    blocker=$(work_record "$ref")
    blocker_ids+=("$(jq -r .workId <<<"$blocker")")
done

record=$(lar-work create --title "$title" --repository "$(jq -r .repository <<<"$parent")" --kind "$kind")
work_id=$(jq -r .workId <<<"$record")
# step <lar-work args>: runs a change to the new record, keeping its latest revision in $record. A failure names the
# record made so far, which the caller finishes with lar-work or sets aside.
step() {
    if ! record=$(lar-work "$1" "$work_id" --revision "$(jq -r .revision <<<"$record")" "${@:2}"); then
        echo "slice.sh: made $work_id, but couldn't $1 it. Finish it with lar-work or set it aside." >&2
        exit 1
    fi
}
step set-body --body "$([[ $kind == decision ]] && echo decision || echo brief)" --file "$body"
step set-parent --parent "$parent_id"
for blocker_id in ${blocker_ids[@]+"${blocker_ids[@]}"}; do step add-blocker --blocker "$blocker_id"; done

echo "$work_id"
ask_boards_to_read "$parent_id"
