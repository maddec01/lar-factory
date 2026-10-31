#!/bin/bash
# Usage: status.sh <work ID | ticket> <Status>
# Sets the work record's Status through lar-work, which writes only this machine's
# work-record database and never a ticket, label, tag or Azure State. <ticket> is a
# picked ticket, as work.sh takes it. A pull request has no board status; set the
# status on the work it delivers. Done is never set by hand: the board sets it once
# lar-work completion finds the work complete, such as a build's recorded PR merging.
# Then asks each running local board to read the record now, as boards.sh says.
set -euo pipefail

usage="usage: status.sh <work ID | owner/repo#n | issue or Azure work item URL> <Status>"
ref=${1:?$usage}
status=${2:?$usage}

# shellcheck source-path=SCRIPTDIR source=boards.sh
source "$(dirname "$0")/boards.sh"
# shellcheck source-path=SCRIPTDIR source=work.sh
source "$(dirname "$0")/work.sh"
if [[ $status == Done ]]; then
    echo "Done isn't set by hand. The board sets it once lar-work completion <work ID> says the work is complete." >&2
    exit 1
fi
if [[ $ref =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]]; then
    echo "$ref has no board status. Set the status on the work it delivers." >&2
    exit 1
fi

record=$(work_record "$ref")
work_id=$(jq -r .workId <<<"$record")
# lar-work names an unknown Status, or a record that changed since the read, on stderr.
lar-work update "$work_id" --revision "$(jq -r .revision <<<"$record")" --status "$status" >/dev/null
echo "$work_id → $status"

ask_boards_to_read "$work_id"
