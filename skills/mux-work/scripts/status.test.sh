#!/usr/bin/env bash
# Tests status.sh's read request to the board against a fake gh and local
# listeners on 127.0.0.1. No network.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
status_sh="$here/status.sh"

failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

# A fake gh that answers the project calls status.sh makes. A fake curl logs
# its arguments, then runs the real curl unless FAKE_CURL_OFF is set.
bin=$(mktemp -d)
log="$bin/log"
real_curl=$(command -v curl)
cat >"$bin/gh" <<'GH'
#!/bin/bash
case "$1 $2" in
"project view") echo PVT_1 ;;
"project field-list") echo '{"fields":[{"id":"FIELD_1","name":"Status","options":[{"id":"OPT_1","name":"Ready to merge"}]}]}' ;;
"project item-add") echo PVTI_1 ;;
"project item-edit") echo "edit ${*:3}" >>"$FAKE_GH_LOG" ;;
*) echo "fake gh: unexpected $*" >&2; exit 1 ;;
esac
GH
cat >"$bin/curl" <<CURL
#!/bin/bash
printf 'curl' >>"\$FAKE_GH_LOG"; printf ' %q' "\$@" >>"\$FAKE_GH_LOG"; echo >>"\$FAKE_GH_LOG"
[[ -z "\${FAKE_CURL_OFF:-}" ]] || exit 0
exec "$real_curl" "\$@"
CURL
# listen <mode>: a one-connection listener on a free port. "board" answers 202
# and saves the request; "slow" never answers; "other" answers a 404 page.
# "live" is a board that keeps answering: /healthz with 200, anything else with
# 202, appending each request line to the request file.
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
    open(request_file, 'ab').write(line)
    code = b'200 OK' if line.split()[1:2] == [b'/healthz'] else b'202 Accepted'
    conn.sendall(b'HTTP/1.1 ' + code + b'\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}')
    conn.close()
conn, _ = server.accept()
conn.settimeout(2)
data = b''
while b'\r\n\r\n' not in data:
    data += conn.recv(4096)
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
chmod +x "$bin/gh" "$bin/curl"
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
# status.sh reads board records from this home, never the real one.
export HOME="$bin/home"
records="$HOME/Library/Application Support/Mux Factory/boards"
record() { mkdir -p "$records"; printf '{"port":%s}' "$2" >"$records/$1.json"; }
free_port() { python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

url=https://github.com/maddec01/mux-factory/issues/7
expected="$url → Ready to merge"

# run [port]: runs status.sh with fresh logs, sets $output, $errors, $status and $seconds.
run() {
    : >"$log"
    status=0
    local start=$SECONDS
    output=$(MUX_BOARD_PORT=${1:-} bash "$status_sh" maddec01/mux-factory#7 "Ready to merge" 2>"$bin/err") || status=$?
    seconds=$((SECONDS - start))
    errors=$(cat "$bin/err")
}
same_as_today() { ((status == 0)) && [[ $output == "$expected" && -z $errors ]] && (($(grep -c '^edit' "$log") == 1)); }
curls() { grep -c '^curl' "$log" || true; }

listen board
run "$port"
for _ in $(seq 20); do [[ -s "$bin/request" ]] && break; python3 -c 'import time; time.sleep(0.05)'; done
request=$(cat "$bin/request" 2>/dev/null || true)
if same_as_today && (($(curls) == 1)) && [[ $(sed -n 1p "$log") == edit* ]] &&
    [[ $request == "POST /api/read HTTP/1.1"* ]] && grep -qi "^Host: 127.0.0.1:$port" <<<"$request" &&
    grep -qi "^Origin: http://127.0.0.1:$port" <<<"$request" && grep -qi '^Content-Type: application/json' <<<"$request" &&
    grep -q -- '--max-time 1' "$log"; then
    pass "after setting the status, asks the board for a read once with JSON and its Origin"
else
    fail "after setting the status, asks the board for a read once with JSON and its Origin: $status $output / $errors / $(cat "$log") / $request"
fi

# With no records and no MUX_BOARD_PORT there is no board to ask.
: >"$log"
status=0
output=$(env -u MUX_BOARD_PORT bash "$status_sh" maddec01/mux-factory#7 "Ready to merge" 2>"$bin/err") || status=$?
errors=$(cat "$bin/err")
if same_as_today && (($(curls) == 0)); then
    pass "with no board records and no MUX_BOARD_PORT, asks no board"
else
    fail "with no board records and no MUX_BOARD_PORT, asks no board: $status $output / $errors / $(cat "$log")"
fi

# Two live boards, a stale record whose process is gone (its port answers, to
# show the PID decides) and a live process whose port answers nothing.
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
if same_as_today && [[ $(requests a) == "GET /healthz"*"POST /api/read"* && $(requests b) == "GET /healthz"*"POST /api/read"* ]] &&
    (($(reads a) == 1 && $(reads b) == 1)) && [[ -z $(requests stale) ]]; then
    pass "asks each recorded board whose process lives and whose /healthz answers, and skips stale records"
else
    fail "asks each recorded board whose process lives and whose /healthz answers, and skips stale records: $status $output / $errors / a: $(requests a) / b: $(requests b) / stale: $(requests stale)"
fi

: >"$bin/a"; : >"$bin/b"
run "$b_port"
if same_as_today && (($(reads b) == 1)) && [[ -z $(requests a) ]]; then
    pass "MUX_BOARD_PORT asks only the board on that port"
else
    fail "MUX_BOARD_PORT asks only the board on that port: $status $output / $errors / a: $(requests a) / b: $(requests b)"
fi

: >"$bin/a"; : >"$bin/b"
run '4317/x?'
if same_as_today && (($(reads a) == 1 && $(reads b) == 1)) && ! grep -q '4317' "$log"; then
    pass "a MUX_BOARD_PORT that isn't a number is ignored for the records"
else
    fail "a MUX_BOARD_PORT that isn't a number is ignored for the records: $status $output / $errors / $(cat "$log")"
fi
rm -rf "$records"

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

((failures == 0))
