# shellcheck shell=bash
# Sourced by status.sh and slice.sh: work_record <ref> prints the work record <ref>
# names, as lar-work read prints it. <ref> is a work ID or a picked ticket:
# owner/repo#12, its GitHub issue URL, or an Azure work item URL. A ticket that no
# record holds fails with how to pick it on the board. lar-work opens the
# work-record database directly, so this works while the board app is closed.
# Each failure prints its reason on stderr and returns nonzero.

# shellcheck source-path=SCRIPTDIR source=azure.sh
source "$(dirname "${BASH_SOURCE[0]}")/azure.sh"

work_record() {
    local ref=$1 ticket prefix="" records record
    if ! command -v lar-work >/dev/null; then
        echo "lar-work isn't on PATH. Open the Lar Factory app once to install it in ~/.local/bin, then rerun." >&2
        return 1
    fi
    if [[ $ref =~ ^https://github\.com/([^/]+/[^/]+)/issues/([0-9]+)$ ]]; then
        ticket="${BASH_REMATCH[1]}#${BASH_REMATCH[2]}"
    elif [[ $ref =~ ^[^/#[:space:]]+(/[^/#[:space:]]+)+#[0-9]+$ ]]; then
        ticket=$ref
    elif azure_work_item "$ref"; then
        # An Azure ticket is <org>/<project>/<repo>#<id>, and the URL doesn't name the repository.
        ticket=$ref prefix="${az_org##*/}/$az_project/"
    else
        lar-work read "$ref"
        return
    fi
    records=$(lar-work list) || return 1
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
