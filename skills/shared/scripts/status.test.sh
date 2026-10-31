#!/usr/bin/env bash
# Tests status.sh's Status writes through the real lar-work command, on a work-record
# database in a temporary HOME, and its read request to the board against local
# listeners on 127.0.0.1. A fake gh and az log any call, which status.sh must never
# make. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
status_sh="$here/status.sh"
root=$(cd "$here/../../.." && pwd)

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# lar-work runs the workspace's command, as the app's launcher runs its bundle.
# A fake curl logs its arguments, then runs the real curl unless FAKE_CURL_OFF is set.
bin=$(mktemp -d)
log="$bin/log"
real_curl=$(command -v curl)
cat >"$bin/lar-work" <<SH
#!/bin/sh
exec node --disable-warning=ExperimentalWarning "$root/packages/work-records/src/cli.ts" "\$@"
SH
for tool in gh az; do
    cat >"$bin/$tool" <<FAKE
#!/bin/sh
echo "$tool \$*" >>"\$FAKE_GH_LOG"
exit 1
FAKE
done
cat >"$bin/curl" <<CURL
#!/bin/bash
printf 'curl' >>"\$FAKE_GH_LOG"; printf ' %q' "\$@" >>"\$FAKE_GH_LOG"; echo >>"\$FAKE_GH_LOG"
[[ -z "\${FAKE_CURL_OFF:-}" ]] || exit 0
exec "$real_curl" "\$@"
CURL
cat >"$bin/listen.py" <<'PY'
import socket, sys, time
mode, port_file, request_file = sys.argv[1:4]
server = socket.socket()
server.bind(('127.0.0.1', 0))
server.listen(5)
open(port_file, 'w').write(str(server.getsockname()[1]))
while mode == 'live':
    conn, _ = server.accept()
    line = conn.makefile('rb').readline()
    # Other programs on this Mac may probe the port; only status.sh's two requests are logged.
    if line.startswith((b'GET /healthz ', b'POST /api/read ')):
        open(request_file, 'ab').write(line)
    code = b'200 OK' if line.split()[1:2] == [b'/healthz'] else b'202 Accepted'
    conn.sendall(b'HTTP/1.1 ' + code + b'\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')
    conn.close()
# Other programs on this Mac may probe the port; only a POST counts as status.sh's request.
data = b''
while not data.startswith(b'POST '):
    conn, _ = server.accept()
    conn.settimeout(2)
    data = b''
    try:
        while b'\r\n\r\n' not in data:
            chunk = conn.recv(4096)
            if not chunk: break
            data += chunk
    except OSError:
        pass
    if not data.startswith(b'POST '): conn.close()
head, _, body = data.partition(b'\r\n\r\n')
length = next((int(l.split(b':')[1]) for l in head.split(b'\r\n') if l.lower().startswith(b'content-length:')), 0)
while len(body) < length:
    body += conn.recv(4096)
open(request_file, 'wb').write(data[:len(head) + 4] + body)
if mode == 'slow':
    time.sleep(5)
elif mode == 'other':
    conn.sendall(b'HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot found')
else:
    conn.sendall(b'HTTP/1.1 202 Accepted\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')
conn.close()
PY

chmod +x "$bin/lar-work" "$bin/gh" "$bin/az" "$bin/curl"
export FAKE_GH_LOG="$log" PATH="$bin:$PATH"
listeners=
trap 'kill $listeners 2>/dev/null; rm -rf "$bin"' EXIT

port=
pid=
listen() {
    rm -f "$bin/port" "$bin/request"
    python3 "$bin/listen.py" "$1" "$bin/port" "${2:-$bin/request}" &
    pid=$!
    listeners="$listeners $pid"
    disown $pid
    for _ in $(seq 50); do [[ -s "$bin/port" ]] && break; python3 -c 'import time; time.sleep(0.05)'; done
    port=$(cat "$bin/port")
}
# status.sh and lar-work read board records and the database from this home, never the real one.
export HOME="$bin/home"
records="$HOME/Library/Application Support/Lar Factory/boards"
record() { mkdir -p "$records"; printf '{"port":%s}' "$2" >"$records/$1.json"; }
free_port() { python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

# make <ticket or ""> [repository]: creates a List build record and prints its work ID.
make() {
    local args=(create --title "Sign in" --repository "${2:-maddec01/lar-factory}" --kind build)
    [[ -z $1 ]] || args+=(--ticket "$1")
    lar-work "${args[@]}" | jq -r .workId
}
status_of() { lar-work read "$1" | jq -r .status; }
work_id=$(make maddec01/lar-factory#7)
expected="$work_id → Ready to merge"

# run [port]: runs status.sh with fresh logs, sets $output, $errors, $status and $seconds.
run() {
    : >"$log"
    status=0
    local start=$SECONDS
    output=$(LAR_BOARD_PORT=${1:-} bash "$status_sh" maddec01/lar-factory#7 "Ready to merge" 2>"$bin/err") || status=$?
    seconds=$((SECONDS - start))
    errors=$(cat "$bin/err")
}
same_as_today() { ((status == 0)) && [[ $output == "$expected" && -z $errors ]] && [[ $(status_of "$work_id") == "Ready to merge" ]]; }
curls() { grep -c '^curl' "$log" || true; }

listen board
run "$port"
for _ in $(seq 20); do [[ -s "$bin/request" ]] && break; python3 -c 'import time; time.sleep(0.05)'; done
request=$(cat "$bin/request" 2>/dev/null || true)
if same_as_today && (($(curls) == 1)) &&
    [[ $request == "POST /api/read HTTP/1.1"* ]] && grep -qi "^Host: 127.0.0.1:$port" <<<"$request" &&
    grep -qi "^Origin: http://127.0.0.1:$port" <<<"$request" && grep -qi '^Content-Type: application/json' <<<"$request" &&
    grep -q -- '--max-time 1' "$log" && grep -qF -- "\\\"workId\\\":\\\"$work_id\\\"" "$log"; then
    pass "after setting the status, asks the board for a read of the record once with JSON and its Origin"
else
    fail "after setting the status, asks the board for a read of the record once with JSON and its Origin: $status $output / $errors / $(cat "$log") / $request"
fi

# With no records and no LAR_BOARD_PORT there is no board to ask.
: >"$log"
status=0
output=$(env -u LAR_BOARD_PORT bash "$status_sh" maddec01/lar-factory#7 "Ready to merge" 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
if same_as_today && (($(curls) == 0)); then
    pass "with no board records and no LAR_BOARD_PORT, asks no board"
else
    fail "with no board records and no LAR_BOARD_PORT, asks no board: $status $output / $errors / $(cat "$log")"
fi

# Two live boards, a stale record whose process is gone (its port answers, to
# show the PID decides) and a live process whose port answers nothing. Other
# programs on this Mac may probe the ports, so only status.sh's requests count.
listen live "$bin/a"; a_pid=$pid a_port=$port
listen live "$bin/b"; b_pid=$pid b_port=$port
listen live "$bin/stale"; stale_port=$port
sleep 0 & dead_pid=$!; wait $dead_pid
record "$a_pid" "$a_port"
record "$b_pid" "$b_port"
record "$dead_pid" "$stale_port"
record $$ "$(free_port)"
requests() { cat "$bin/$1" 2>/dev/null || true; }
reads() { grep -c '^POST /api/read ' "$bin/$1" 2>/dev/null || true; }
: >"$bin/a"; : >"$bin/b"; : >"$bin/stale"
run
if same_as_today && [[ $(requests a) == *"GET /healthz"*"POST /api/read"* && $(requests b) == *"GET /healthz"*"POST /api/read"* ]] &&
    (($(reads a) == 1 && $(reads b) == 1)) && ! grep -aq '^GET /healthz \|^POST /api/read ' "$bin/stale"; then
    pass "asks each recorded board whose process lives and whose /healthz answers, and skips stale records"
else
    fail "asks each recorded board whose process lives and whose /healthz answers, and skips stale records: $status $output / $errors / a: $(requests a) / b: $(requests b) / stale: $(requests stale)"
fi

: >"$bin/a"; : >"$bin/b"
run "$b_port"
if same_as_today && (($(reads b) == 1)) && [[ -z $(requests a) ]]; then
    pass "LAR_BOARD_PORT asks only the board on that port"
else
    fail "LAR_BOARD_PORT asks only the board on that port: $status $output / $errors / a: $(requests a) / b: $(requests b)"
fi

: >"$bin/a"; : >"$bin/b"
run '4317/x?'
if same_as_today && (($(reads a) == 1 && $(reads b) == 1)) && ! grep -q ':4317/' "$log"; then
    pass "a LAR_BOARD_PORT that isn't a number is ignored for the records"
else
    fail "a LAR_BOARD_PORT that isn't a number is ignored for the records: $status $output / $errors / $(cat "$log")"
fi
elsewhere="$bin/elsewhere"
mkdir -p "$elsewhere/boards"
mv "$records"/*.json "$elsewhere/boards/"
: >"$bin/a"; : >"$bin/b"
: >"$log"
status=0
elsewhere_id=$(LAR_FACTORY_DATA_DIR=$elsewhere make "")
output=$(LAR_FACTORY_DATA_DIR=$elsewhere bash "$status_sh" "$elsewhere_id" "Ready to merge" 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
if ((status == 0)) && (($(reads a) == 1 && $(reads b) == 1)) &&
    [[ $(LAR_FACTORY_DATA_DIR=$elsewhere status_of "$elsewhere_id") == "Ready to merge" ]]; then
    pass "finds the work record and the board records in the data folder LAR_FACTORY_DATA_DIR names"
else
    fail "finds the work record and the board records in the data folder LAR_FACTORY_DATA_DIR names: $status $output / $errors / a: $(requests a)"
fi
rm -rf "$records" "$elsewhere"

run "$(free_port)"
if same_as_today && (($(curls) == 1)); then
    pass "a board that is down changes nothing"
else
    fail "a board that is down changes nothing: $status $output / $errors / $(cat "$log")"
fi

listen slow
run "$port"
if same_as_today && ((seconds <= 3)); then
    pass "a slow board changes nothing and holds status.sh about a second"
else
    fail "a slow board changes nothing and holds status.sh about a second: $status $output / $errors / ${seconds}s"
fi

listen other
run "$port"
if same_as_today; then
    pass "another listener on the port changes nothing"
else
    fail "another listener on the port changes nothing: $status $output / $errors"
fi

# set <ref> <Status>: runs status.sh with fresh logs and no board to ask, sets
# $output, $errors and $status.
set_status() {
    : >"$log"
    status=0
    output=$(FAKE_CURL_OFF=1 bash "$status_sh" "$1" "$2" 2>"$bin/err") || status=$?
    errors=$(cat "$bin/err")
}
no_provider() { ! grep -q '^gh \|^az ' "$log"; }
# sets <name> <work ID> <Status>: passes when the run printed the change and the record holds it, with no provider call.
sets() {
    if ((status == 0)) && [[ $output == "$2 → $3" && -z $errors ]] && [[ $(status_of "$2") == "$3" ]] && no_provider; then
        pass "$1"
    else
        fail "$1: $status $output / $errors / $(status_of "$2") / $(cat "$log")"
    fi
}
# refuses <name> <text> [work ID]: passes when the run failed, printed nothing, named the text on stderr, asked no
# board and called no provider, leaving the work ID's record in List.
refuses() {
    if ((status != 0)) && [[ -z $output && $errors == *"$2"* ]] && (($(curls) == 0)) && no_provider &&
        { [[ -z ${3:-} ]] || [[ $(status_of "$3") == List ]]; }; then
        pass "$1"
    else
        fail "$1: $status $output / $errors / $(cat "$log")"
    fi
}

id=$(make "")
set_status "$id" Shaping
sets "a work ID sets that record's Status, and nothing on a provider" "$id" Shaping

id=$(make maddec01/lar-factory#8)
set_status maddec01/lar-factory#8 Queued
sets "a picked ticket sets its record's Status" "$id" Queued

set_status https://github.com/maddec01/lar-factory/issues/8 "Needs you"
sets "a picked ticket's issue URL sets its record's Status" "$id" "Needs you"

id=$(make contoso/Fabrikam/web#42 contoso/Fabrikam/web)
make contoso/Fabrikam/other#43 contoso/Fabrikam/other >/dev/null
set_status https://dev.azure.com/contoso/Fabrikam/_workitems/edit/42 Review
sets "a picked Azure work item URL sets its record's Status, never Azure State or a tag" "$id" Review

set_status https://contoso.visualstudio.com/Fabrikam/_workitems/edit/42 Verify
sets "takes a work item URL on an older visualstudio.com organization" "$id" Verify

set_status maddec01/lar-factory#99 Ready
refuses "an unpicked ticket says to pick it on the board, writing nothing" "maddec01/lar-factory#99 has no work record. Pick the ticket on the board"

set_status https://dev.azure.com/contoso/Fabrikam/_workitems/edit/44 Ready
refuses "an unpicked Azure work item says to pick it on the board" "contoso/Fabrikam/_workitems/edit/44 has no work record. Pick the ticket on the board"

id=$(make "")
set_status "$id" Done
refuses "refuses Done, which completion reads from the record" "Done isn't set by hand" "$id"

set_status "$id" Sideways
refuses "an unknown Status passes lar-work's reason through" 'The Status "Sideways" isn'"'"'t one of' "$id"

set_status 00000000-0000-0000-0000-000000000000 Ready
refuses "an unknown work ID passes lar-work's reason through" "lar-work: "

set_status https://github.com/maddec01/lar-factory/pull/3 Review
refuses "a PR has no board status" "has no board status. Set the status on the work it delivers"

: >"$log"
status=0
output=$(PATH="$(dirname "$(command -v jq)"):/usr/bin:/bin" bash "$status_sh" "$id" Ready 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
refuses "without lar-work on PATH, says how to install it" "lar-work isn't on PATH. Open the Lar Factory app once" "$id"

# work.sh run as a command prints the record a picked ticket names, as a manual thread resolves its argument.
id=$(make maddec01/lar-factory#9)
status=0
output=$(bash "$here/work.sh" maddec01/lar-factory#9 2>"$bin/err") || status=$?
if ((status == 0)) && [[ $(jq -r .workId <<<"$output") == "$id" ]]; then
    pass "work.sh prints the record a picked ticket names"
else
    fail "work.sh prints the record a picked ticket names: $status $output / $(cat "$bin/err")"
fi
status=0
output=$(bash "$here/work.sh" maddec01/lar-factory#98 2>"$bin/err") || status=$?
if ((status != 0)) && [[ -z $output ]] && grep -q "Pick the ticket on the board, then rerun" "$bin/err"; then
    pass "work.sh says how to pick an unpicked ticket"
else
    fail "work.sh says how to pick an unpicked ticket: $status $output / $(cat "$bin/err")"
fi

: >"$log"
output=$(LAR_BOARD_PORT=4999 FAKE_CURL_OFF=1 bash "$status_sh" "$id" Review 2>&1) || true
if grep -q "^curl.*127.0.0.1:4999/api/read" "$log"; then
    pass "after a write by work ID, asks the board for a read"
else
    fail "after a write by work ID, asks the board for a read: $output / $(cat "$log")"
fi

((failures == 0))
