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
[[ -n "$NODE" ]] || { echo "node not found on PATH" >&2; exit 1; }
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "node $("$NODE" --version) is too old; the board needs 22.18 or newer" >&2; exit 1; }
# The board looks gh and t3 up itself and finds them once installed; only warn here.
if ! command -v gh >/dev/null; then
  echo "warning: gh not found on PATH; the board shows how to install it" >&2
elif ! gh auth status >/dev/null 2>&1; then
  echo "warning: gh is not logged in; the board shows how to log in" >&2
fi
command -v t3 >/dev/null || echo "warning: t3 not found on PATH; the board shows a notice until the T3 Code CLI is installed" >&2
LAUNCH_TOKEN="${BOARD_LAUNCH_TOKEN:-$("$NODE" -p 'crypto.randomUUID()')}"

# launchd starts with a bare PATH. The updater runs node, and pnpm and gh from Homebrew.
AGENT_PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# XML-escape a value, then escape it for the sed replacement below.
escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' | sed -e 's/[&|\\]/\\&/g'
}

render() {
  sed -e "s|@LABEL@|$(escape "$LABEL")|g" \
      -e "s|@NODE@|$(escape "$NODE")|g" \
      -e "s|@BOARD_DIR@|$(escape "$BOARD_DIR")|g" \
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

echo "Installed $PLIST"
echo "Board: http://127.0.0.1:4317  Log: $LOG"
