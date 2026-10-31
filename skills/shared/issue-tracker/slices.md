# Slices

[Work records](work-records.md) covers the commands below. A slice is a private
record its build owns, on every provider. Slices are never published and have
no Status; the board shows them inside their build's card.

Create each slice with `slice.sh`, which prints its work ID, and list the
slices it waits on:

```sh
bash <this skill>/shared/scripts/slice.sh "$build" "<title>" /path/to/slice.md --blocked-by "$earlier"
```

An **active slice** is one an implementer is working on now. Record the
implementer's child thread on the slice as it starts:
`lar-work add-thread "$slice" --revision N --thread <childThreadId> --purpose implement`.

A **blocked slice** is one its implementer couldn't finish. The builder records
the implementer's reason with
`lar-work set-needs-you "$slice" --revision N --reason "Blocked: <reason>"`; a
re-slice planner claims it with `lar-work clear-needs-you`.

Record a slice that merged into the build branch with
`lar-work finish "$slice" --revision N`. A ready slice is unfinished, not set
aside, carries no Needs you, and `lar-work waiting-on` prints nothing for it:

```sh
lar-work children "$build" |
  jq -r '.[] | select(.finishedAt == null and (.setAside | not) and .needsYou == null) | .workId' |
  while read -r slice; do
    [ "$(lar-work waiting-on "$slice")" = "[]" ] && lar-work read "$slice" | jq -r '"\(.workId) \(.title)"'
  done
```

A **re-slice** works in place and keeps no history. The planner rewrites the
blocked slice's brief (`lar-work set-body "$slice" --revision N --body brief --file F`)
to hold the work left, and may rewrite any other unfinished slice that isn't
active. It creates a slice only when the work needs another, and sets one aside
(`lar-work set-aside`) only once its content moved into another. Blockers
follow the content: move a set-aside slice's dependents onto the slice that
took its work with `add-blocker` and `remove-blocker`.
