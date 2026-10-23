#!/bin/sh
# Test-only login shell: runs `<shell> -ilc <script>` with the PATH it was given, without reading any profile.
exec /bin/sh -c "$2"
