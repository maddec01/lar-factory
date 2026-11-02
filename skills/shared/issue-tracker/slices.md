# Slices

A slice is a private, statusless record owned by a buildable item and shown inside
its board card. [Work records](work-records.md) covers the commands. Create one
with `slice.sh`, which returns its work ID; list prerequisites with `--blocked-by`:

```sh
bash <this skill>/shared/scripts/slice.sh "$build" "<title>" /path/to/slice.md --blocked-by "$earlier"
```

## Launch reporting and recovery

Before launch or retry, including resume, reconcile recorded `implement` threads
with launch results in this thread or handoff. Read known child states without
polling. Repair missing associations; if a child cannot be identified safely,
report it and stop that slice's relaunch. Missing association never proves no launch.

Confirm build phase `implement` before launching. Preserve each returned slice
work ID, `taskId` and `childThreadId`. Before yielding, confirm every child's
association, even if already completed:
`lar-work add-thread "$slice" --revision N --thread <childThreadId> --purpose implement`.
The board derives activity from child state; completion still requires merge and finish.

On failed or uncertain writes, report the identities and error, reread records
and threads, and retry only missing writes with fresh revisions and the same
child. Never redelegate to repair reporting. If still failing, preserve the gap
and identities in the thread or handoff, follow T3's wait instruction, and repair
on resume. A failed phase write blocks new launches.

## Slice lifecycle

Record a **blocked slice** with
`lar-work set-needs-you "$slice" --revision N --reason "Blocked: <reason>"`;
a re-slice planner claims it with `lar-work clear-needs-you`.
After merging, run `lar-work finish "$slice" --revision N`.
Select ready slices:

```sh
lar-work children "$build" |
  jq -r '.[] | select(.finishedAt == null and (.setAside | not) and .needsYou == null) | .workId' |
  while read -r slice; do
    [ "$(lar-work waiting-on "$slice")" = "[]" ] && lar-work read "$slice" | jq -r '"\(.workId) \(.title)"'
  done
```

A **re-slice** rewrites remaining work in place with
`lar-work set-body "$slice" --revision N --body brief --file F`, including other
unfinished, inactive slices as needed. Create slices only for additional work.
Use `lar-work set-aside` only after moving its content; move its dependents to
the receiving slice with `add-blocker` and `remove-blocker`.
