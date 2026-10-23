#!/bin/sh
# Test-only login shell: runs `<shell> -ilc <script>` with the PATH it was given, without reading any profile.
# With FAKE_SHELL_LOG set it adds a line there per run, so tests can count login PATH reads.
[ -n "$FAKE_SHELL_LOG" ] && echo run >> "$FAKE_SHELL_LOG"
exec /bin/sh -c "$2"
