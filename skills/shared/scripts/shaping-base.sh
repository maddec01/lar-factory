#!/bin/bash
# Fetch the remote's current default branch without changing the checkout.
# Usage: shaping-base.sh <checkout>; stdout is local exploration evidence JSON.
set -euo pipefail

if [[ $# != 1 ]]; then
    echo 'usage: shaping-base.sh <checkout>' >&2
    exit 1
fi
checkout=$1
advertised=$(git -C "$checkout" ls-remote --symref origin HEAD)
default_ref=$(awk '$1 == "ref:" && $3 == "HEAD" { print $2 }' <<<"$advertised")
if [[ $default_ref != refs/heads/* ]] || ! git check-ref-format "$default_ref"; then
    echo 'Cannot resolve origin default branch; do not explore a stale local branch.' >&2
    exit 1
fi
tracking_ref="refs/remotes/origin/${default_ref#refs/heads/}"
git -C "$checkout" fetch --no-tags --no-recurse-submodules origin "+$default_ref:$tracking_ref" >&2
revision=$(git -C "$checkout" rev-parse --verify "$tracking_ref^{commit}")
jq -n --arg ref "${tracking_ref#refs/remotes/}" --arg revision "$revision" \
    '{ref: $ref, revision: $revision}'
