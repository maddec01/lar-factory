#!/bin/sh
# Stands in for ssh on a fetch: refuses unless it runs in batch mode, then serves FAKE_ORIGIN.
case "$*" in *BatchMode=yes*) ;; *) echo 'fake ssh: no BatchMode' >&2; exit 255 ;; esac
exec git upload-pack "$FAKE_ORIGIN"
