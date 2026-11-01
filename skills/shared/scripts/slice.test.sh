#!/usr/bin/env bash
# Tests slice.sh through the real lar-work command, on a work-record database in a
# temporary HOME. A fake gh and az log any call, which slice.sh must never make, and
# a fake curl logs the board read it asks for. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
slice_sh="$here/slice.sh"
root=$(cd "$here/../../.." && pwd)

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# lar-work runs the workspace's command, as the app's launcher runs its bundle.
bin=$(mktemp -d)
trap 'rm -rf "$bin"' EXIT
log="$bin/log"
cat >"$bin/lar-work" <<SH
#!/bin/sh
exec node --disable-warning=ExperimentalWarning "$root/packages/work-records/src/cli.ts" "\$@"
SH
for tool in gh az curl; do
    cat >"$bin/$tool" <<FAKE
#!/bin/sh
echo "$tool \$*" >>"$log"
FAKE
done
chmod +x "$bin/lar-work" "$bin/gh" "$bin/az" "$bin/curl"
export PATH="$bin:$PATH" HOME="$bin/home" LAR_BOARD_PORT=4999
export LAR_FACTORY_DATA_DIR="$HOME/Library/Application Support/Lar Factory"
printf '## What to build\n\nThe sign-in form.\n' >"$bin/body.md"

# make <kind> [ticket]: creates a record in maddec01/lar-factory and prints its work ID.
make() {
    local args=(create --title "Work" --repository maddec01/lar-factory --kind "$1")
    [[ -z ${2:-} ]] || args+=(--ticket "$2")
    lar-work "${args[@]}" | jq -r .workId
}
# run <args>: runs slice.sh with a fresh log, sets $output, $errors and $status.
run() {
    : >"$log"
    status=0
    output=$(bash "$slice_sh" "$@" 2>"$bin/err") || status=$?
    errors=$(cat "$bin/err")
}
no_provider() { ! grep -q '^gh \|^az ' "$log"; }
count() { lar-work list | jq length; }
# refuses <name> <text>: passes when the run failed, printed nothing, named the text, called no provider and made
# no record.
refuses() {
    if ((status != 0)) && [[ -z $output && $errors == *"$2"* ]] && no_provider && (($(count) == before)); then
        pass "$1"
    else
        fail "$1: $status $output / $errors / $(cat "$log")"
    fi
}

build=$(make build maddec01/lar-factory#30)
first=$(make slice)
run "$build" "Sign in" "$bin/body.md"
record=$(lar-work read "$output" 2>/dev/null || true)
if ((status == 0)) && [[ -z $errors ]] && jq -e --arg build "$build" '.kind == "slice" and .title == "Sign in"
    and .parentId == $build and .repository == "maddec01/lar-factory" and .ticket == null' <<<"$record" >/dev/null &&
    [[ $(lar-work body "$output" --body brief) == "$(cat "$bin/body.md")" ]] && no_provider &&
    grep -q "^curl .*127.0.0.1:4999/api/read" "$log" && grep -qF "\"workId\":\"$build\"" "$log"; then
    pass "a build's work ID gets a private slice record with the brief, no ticket, and the board asked to read the build"
else
    fail "a build's work ID gets a private slice record with the brief, no ticket, and the board asked to read the build: $status $output / $errors / $record / $(cat "$log")"
fi
slice=$output

run maddec01/lar-factory#30 "Sign out" "$bin/body.md" --blocked-by "$slice" --blocked-by "$first"
if ((status == 0)) && [[ $(lar-work read "$output" | jq -r .parentId) == "$build" ]] &&
    [[ $(lar-work blockers "$output" | jq -c '[.[].workId] | sort') == "$(jq -cn --arg a "$slice" --arg b "$first" '[$a, $b] | sort')" ]] && no_provider; then
    pass "a picked build ticket gets the slice, with each --blocked-by as a blocker edge"
else
    fail "a picked build ticket gets the slice, with each --blocked-by as a blocker edge: $status $output / $errors"
fi

concept=$(make concept)
run "$concept" "Which store" "$bin/body.md" --kind decision
if ((status == 0)) && [[ $(lar-work read "$output" | jq -r '.kind + " " + .parentId') == "decision $concept" ]] &&
    [[ $(lar-work body "$output" --body decision) == "$(cat "$bin/body.md")" ]]; then
    pass "under a concept, --kind decision makes a decision with the text as its decision"
else
    fail "under a concept, --kind decision makes a decision with the text as its decision: $status $output / $errors"
fi

before=$(count)
run maddec01/lar-factory#99 "Sign in" "$bin/body.md"
refuses "an unpicked build ticket says to pick it on the board, making nothing" "maddec01/lar-factory#99 has no work record. Pick the ticket on the board"

run "$build" "Sign in" "$bin/body.md" --blocked-by maddec01/lar-factory#98
refuses "an unpicked blocker makes nothing" "maddec01/lar-factory#98 has no work record"

run "$concept" "Store" "$bin/body.md"
refuses "under a concept, a missing --kind is refused" "under a concept, --kind names decision or build"

run "$build" "Store" "$bin/body.md" --kind decision
refuses "a build takes no other kind" "a build owns only slices"

run "$slice" "Deeper" "$bin/body.md"
refuses "a slice owns no work" "only a build or a concept owns work"

run "$build" "Sign in" "$bin/missing.md"
refuses "a body file it can't read makes nothing" "can't read $bin/missing.md"

run "$build" "Sign in" "$bin/body.md" --parent x
refuses "an unknown option shows the usage" "usage: slice.sh"

((failures == 0))
