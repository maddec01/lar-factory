#!/usr/bin/env bash
# Tests slice.sh against a fake gh and a fake sleep. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
slice="$here/slice.sh"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# A fake gh. `issue create` logs its args and prints the new issue's URL. Each
# Project item query prints line N of $FAKE_GH_ITEMS (item ids, comma-separated)
# on poll N, then the last line forever; it fails on a line "!fail" or if
# FAKE_GH_QUERY_FAILS is set;
# `project item-delete` logs the id.
bin=$(mktemp -d)
log="$bin/log"
cat >"$bin/gh" <<'EOF'
#!/bin/bash
case "$1 $2" in
"issue create")
    echo "create ${*:3}" >>"$FAKE_GH_LOG"
    echo "https://github.com/maddec01/mux-factory/issues/999"
    ;;
"api graphql")
    poll=$(( $(grep -c '^query' "$FAKE_GH_LOG") + 1 ))
    echo "query" >>"$FAKE_GH_LOG"
    [[ -z "${FAKE_GH_QUERY_FAILS:-}" ]] || { echo "fake gh: query failed" >&2; exit 1; }
    line=$(sed -n "${poll}p" "$FAKE_GH_ITEMS")
    [[ -n "$line" ]] || line=$(tail -n1 "$FAKE_GH_ITEMS")
    [[ $line != "!fail" ]] || { echo "fake gh: query failed" >&2; exit 1; }
    [[ -z "$line" ]] || tr ',' '\n' <<<"$line"
    ;;
"project item-delete")
    echo "delete ${*:3}" >>"$FAKE_GH_LOG"
    ;;
*)
    echo "fake gh: unexpected $*" >&2
    exit 1
    ;;
esac
EOF
cat >"$bin/sleep" <<'EOF'
#!/bin/bash
echo "sleep $*" >>"$FAKE_GH_LOG"
EOF
chmod +x "$bin/gh" "$bin/sleep"
items="$bin/items"
export FAKE_GH_LOG="$log" FAKE_GH_ITEMS="$items" PATH="$bin:$PATH"

body="$bin/body.md"
echo "What to build" >"$body"

# run <items, one line per poll>: runs slice.sh with fresh logs, sets $output
# (stdout), $errors (stderr) and $status.
run() {
    printf '%s\n' "$@" >"$items"
    : >"$log"
    status=0
    output=$(bash "$slice" maddec01/mux-factory 133 "A slice" "$body" 2>"$bin/err") || status=$?
    errors=$(cat "$bin/err")
}
count() { grep -c "^$1" "$log" || true; }

url=https://github.com/maddec01/mux-factory/issues/999

run "PVTI_a" ""
if ((status == 0)) && [[ $output == "$url" ]] &&
    [[ $(head -n1 "$log") == "create --repo maddec01/mux-factory --parent 133 --title A slice --body-file $body" ]] &&
    [[ $(grep '^delete' "$log") == "delete 1 --owner maddec01 --id PVTI_a" ]] &&
    (($(count query) == 2)) && (($(count 'sleep 2') == 1)) && [[ $errors == *"watching"* ]]; then
    pass "an item on the Project is removed, polling stops at the next empty poll, the URL is printed"
else
    fail "an item on the Project is removed, polling stops at the next empty poll, the URL is printed: $status $output / $errors / $(cat "$log")"
fi

run ""
if ((status == 0)) && [[ $output == "$url" ]] && (($(count delete) == 0)) &&
    (($(count query) == 11)) && (($(count 'sleep 2') == 10)); then
    pass "an issue that never lands on the Project polls the whole window and succeeds"
else
    fail "an issue that never lands on the Project polls the whole window and succeeds: $status $output / $(cat "$log")"
fi

run "" "" "" "PVTI_late" ""
if ((status == 0)) && [[ $output == "$url" ]] &&
    [[ $(grep '^delete' "$log") == "delete 1 --owner maddec01 --id PVTI_late" ]] &&
    (($(count query) == 5)); then
    pass "a late auto-add is removed on a later poll"
else
    fail "a late auto-add is removed on a later poll: $status $output / $(cat "$log")"
fi

run "PVTI_stuck"
if ((status != 0)) && [[ $errors == *"$url"*"still on the Mux board"* ]] &&
    [[ $errors == *"gh project item-delete 1 --owner maddec01 --id PVTI_stuck"* ]]; then
    pass "an item that persists after the poll fails with the command that removes it"
else
    fail "an item that persists after the poll fails with the command that removes it: $status $errors"
fi

FAKE_GH_QUERY_FAILS=1 run ""
if ((status != 0)) && [[ -z $output ]] && [[ $errors == *"created $url"*"don't rerun"*"gh project item-list"* ]]; then
    pass "a failure after creation names the created slice"
else
    fail "a failure after creation names the created slice: $status $output / $errors"
fi

run "PVTI_a" "!fail"
if ((status != 0)) && [[ $(grep '^delete' "$log") == "delete 1 --owner maddec01 --id PVTI_a" ]] &&
    [[ $errors == *"created $url"*"may be on the Mux board"*"gh project item-list"* ]] &&
    [[ $errors != *"--id PVTI_a"* ]]; then
    pass "a failure after a removal doesn't ask to remove the already-removed item"
else
    fail "a failure after a removal doesn't ask to remove the already-removed item: $status $errors / $(cat "$log")"
fi

: >"$log"
if SLICE_POLL_INTERVAL=1 SLICE_POLL_TIMEOUT=3 run "" && (($(count query) == 4)) && (($(count 'sleep 1') == 3)); then
    pass "the poll interval and timeout are overridable"
else
    fail "the poll interval and timeout are overridable: $(cat "$log")"
fi

if output=$(bash "$slice" maddec01/mux-factory 133 2>&1); then
    fail "missing arguments print usage: $output"
else
    [[ $output == *usage* ]] && pass "missing arguments print usage" || fail "missing arguments print usage: $output"
fi

rm -rf "$bin"
((failures == 0)) || { echo "$failures failed"; exit 1; }
echo "all passed"
