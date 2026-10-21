#!/bin/bash
# Installs (or reinstalls) the launch agent that runs the board at login.
# Safe to run again: it replaces the plist and restarts the agent.
# --print writes the filled-in plist to stdout and changes nothing.
set -euo pipefail

LABEL="nl.mux.factory-board"
BOARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$BOARD_DIR/launchd/$LABEL.plist.template"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mux-board.log"
DOMAIN="gui/$(id -u)"

NODE="$(command -v node || true)"
# Run from the board's Update button, PATH is launchd's short one: keep the board's paths.
GH="$(command -v gh || printf '%s' "${GH_PATH:-}")"
T3="$(command -v t3 || printf '%s' "${T3_PATH:-}")"
[[ -n "$NODE" ]] || { echo "node not found on PATH" >&2; exit 1; }
[[ -n "$GH" ]] || { echo "gh not found on PATH" >&2; exit 1; }
[[ -n "$T3" ]] || echo "warning: t3 not found on PATH; Start will fail until the T3 Code CLI is installed and this is rerun" >&2
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "node $("$NODE" --version) is too old; the board needs 22.18 or newer" >&2; exit 1; }
"$GH" auth status >/dev/null 2>&1 || echo "warning: gh is not logged in; the board will show a stale banner until it is" >&2
LAUNCH_TOKEN="${BOARD_LAUNCH_TOKEN:-$("$NODE" -p 'crypto.randomUUID()')}"

# launchd starts with a bare PATH; give it the directories of node and gh.
AGENT_PATH="$(dirname "$NODE"):$(dirname "$GH"):/usr/bin:/bin:/usr/sbin:/sbin"

# XML-escape a value, then escape it for the sed replacement below.
escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' | sed -e 's/[&|\\]/\\&/g'
}

render() {
  sed -e "s|@LABEL@|$(escape "$LABEL")|g" \
      -e "s|@NODE@|$(escape "$NODE")|g" \
      -e "s|@BOARD_DIR@|$(escape "$BOARD_DIR")|g" \
      -e "s|@GH@|$(escape "$GH")|g" \
      -e "s|@T3@|$(escape "$T3")|g" \
      -e "s|@PATH@|$(escape "$AGENT_PATH")|g" \
      -e "s|@HOME@|$(escape "$HOME")|g" \
      -e "s|@LOG@|$(escape "$LOG")|g" \
      -e "s|@LAUNCH_TOKEN@|$(escape "$LAUNCH_TOKEN")|g" \
      "$TEMPLATE"
}

if [[ "${1:-}" == "--print" ]]; then
  render
  exit 0
fi

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
render > "$PLIST.tmp"
plutil -lint "$PLIST.tmp" >/dev/null
mv "$PLIST.tmp" "$PLIST"

# Replace a running copy, then start the new one.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in 1 2 3 4 5; do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 1
done
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"

PORT="$("$NODE" -e 'console.log(require(process.argv[1]).board?.port ?? 4317)' "$BOARD_DIR/../config.json")"
echo "Installed $PLIST"
echo "Board: http://127.0.0.1:$PORT  Log: $LOG"
