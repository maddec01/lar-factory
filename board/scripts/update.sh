#!/bin/bash
# Update the checkout that holds this script, regardless of the caller's directory.
set -euo pipefail
exec node --disable-warning=ExperimentalWarning "$(dirname "${BASH_SOURCE[0]}")/update.ts"
