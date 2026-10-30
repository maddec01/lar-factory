#!/bin/bash
# Sourced by skill-sync's scripts. Holds the one rule that reads UPSTREAM.md's rows.

# upstream_rows <UPSTREAM.md> <Copies|Ports>
# Prints the rows of the Copies table (header row starting "| Skill |") or of
# the Ports table (header row starting "| Port |"), one line each, as written.
# A row is a line starting "| `"; a table ends at the first line that doesn't
# start with "|".
upstream_rows() {
    local first
    case $2 in
        Copies) first=Skill ;;
        Ports) first=Port ;;
        *) echo "upstream_rows: unknown table '$2'" >&2; return 2 ;;
    esac
    awk -v first="$first" '
        !/^\|/ { inside = 0; next }
        /^\| `/ { if (inside) print; next }
        {
            cell = $0
            sub(/^\|[ \t]*/, "", cell); sub(/[ \t]*\|.*$/, "", cell)
            if (cell == first) inside = 1
        }
    ' "$1"
}
