# Run settings records

P10 supplies local records and CLI commands; P50 connects starts and role execution
to them. None of these commands launches T3 or synchronizes a tracker. All accept
`--data-dir D` (otherwise the normal app data folder). Browser-safe result and
input types live at `@lar-factory/shared/run-settings`. Server callers use the
methods on `openWorkRecords()`.

`lar-work run-settings WORK_ID [--run-id RUN_ID]` returns
`{workId, runs: RunSettings[], roleRuns: RoleRun[]}`. Without a run ID it returns
all runs, oldest first. A legacy record returns empty lists: the migration does
not reconstruct past settings from today's defaults. An unknown explicit run ID
is an error. Reads leave record revisions unchanged.

## Capture and reuse

`lar-work snapshot-run WORK_ID --revision N --file F` reads current machine
Settings and resolves the owning thread and every role once. F contains:

```json
{
    "runId": "stable-logical-run-id",
    "kind": "build",
    "projectDefault": {
        "instanceId": "provider-instance",
        "model": "model-id",
        "options": [{ "id": "reasoningEffort", "value": "high" }]
    },
    "packaged": {
        "version": "installed-package-version",
        "reviewers": {
            "code": "Exact installed Code instruction text",
            "security": "Exact installed Security instruction text",
            "ui": "Exact installed UI instruction text",
            "performance": "Exact installed Performance instruction text"
        }
    },
    "skills": []
}
```

The kind is `shaping`, `concept`, `decision` or `build`. Gate-only work uses
`shaping`. `projectDefault` is optional. `threadSelection`, also optional, holds
a manual Start selection with the same shape and takes precedence over the kind
choice. A missing effective choice remains null; the recorder never invents a
provider or model. Effort is separate from the remaining requested options.

The launch bridge supplies the installed package version and exact packaged
reviewer text. The recorder never reads caller-supplied filesystem paths. Custom
instruction text and its selected revision come from saved Settings. Both
sources have a SHA-256 text digest, and the snapshot retains the complete text,
including for never reviewers. This preserves evidence across package upgrades
as well as Settings edits. Project skills are frozen in the same snapshot.

Reuse the same `runId` on retry and handoff, with the current work revision.
The existing snapshot is returned without rereading Settings or bumping the
revision; changed input cannot replace it. Reusing the ID for a different kind
is refused. Only a new logical run gets a new ID and captures current Settings.
Callers must retain that ID alongside their launch identity (P50). A failed new
capture, including invalid inputs or a Settings recovery warning, writes nothing.

## Requested and reported execution

`lar-work start-role-run WORK_ID --revision N --file F` takes
`{runId, executionId, role, threadId?, taskId?}`. `role` is `thread`, a factory
role, or `reviewer:<id>` from the snapshot. Requested model, provider instance,
effort and options are copied from that snapshot. Actual settings start null.
The same execution ID and identity return the saved attempt without a write;
a retry that launches another execution needs a new execution ID. Handoff uses
the same run ID and the new thread identity.

`lar-work finish-role-run WORK_ID --revision N --file F` takes:

```json
{
    "executionId": "role-attempt-id",
    "result": "completed",
    "report": {
        "source": "t3",
        "reference": "T3 thread/task result identity",
        "actual": {
            "model": { "instanceId": "reported-instance", "model": "reported-model" },
            "effort": "high",
            "options": [{ "id": "reasoningEffort", "value": "high" }]
        }
    }
}
```

The bridge passes only what T3 reports and names its evidence reference. The
records layer validates the shape; it does not independently query T3 or attest
the caller's evidence. Missing values stay null (and absent options use `[]`),
never copied from the request. A missing report is `report: null`. A failure uses
`result: "failed"` and a nonempty `failure` reason, with any available report.
Requested and actual differences are preserved for inspection; enforcing
capabilities and surfacing mismatches are P50's responsibility. Completion is
immutable; an identical replay is a no-op. Each changed write requires the current
work revision and bumps it once. Read the work record for the next revision.

## Review linkage

`record-review-round` accepts `runId`. For a record with snapshots, it must name
an existing build run belonging to that work record. Each reviewer also supplies
`selection: {triggerVersion: 1, outcome, rule, evidence, reason, run}` from the
version-1 matcher. `run` must agree with the verdict; `outcome` is `matched`,
`unmatched` or `uncertain`. Skips keep their reason and trigger evidence.
Escalation provenance remains separate, preserving the original trigger result.

Round validation uses the snapshot's reviewer set and modes, so subsequent edits
cannot remove a custom reviewer or change a running build's never policy.
`review-rounds` returns the link and selection evidence. Legacy rounds keep their
existing JSON shape and have no invented run ID. The caller must pass
`snapshot.settings` to the selection API and use the snapshot's instruction
text; connecting the existing selection CLI and all launch sites is P50.
