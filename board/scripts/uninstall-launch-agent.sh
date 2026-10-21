#!/bin/bash
# Stops the board's launch agent and removes its plist. Safe to run again.
set -euo pipefail

LABEL="nl.mux.factory-board"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL (the log at ~/Library/Logs/mux-board.log is kept)"
