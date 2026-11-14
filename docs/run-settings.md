# Run settings records

The board freezes these records before launching shaping, concept, decision or
build work. It validates the thread target against live T3 capabilities and passes
the run ID and every role target to the thread. None of these commands launches T3 or synchronizes a tracker. All accept
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
The board associates the run with its launch intent through the thread execution ID. A failed new
capture, including invalid inputs or a Settings recovery warning, writes nothing.

## Delegated roles

Save T3's `orchestrator_capabilities` JSON to a file, searching an omitted model
before saving. Then use:

```sh
lar-work role-launch WORK_ID --run-id RUN_ID --role ROLE --capabilities capabilities.json --task brief.md
```

The command reads the frozen role, checks capabilities, maps effort to the
advertised option and records the start. Its JSON is the exact `delegate_task`
argument object: explicit provider/model/options, execution ID as
`clientRequestId`, isolation and task. Implementer and Prototype default to
worktree isolation; other roles default to shared. `--isolation` overrides it.
`--execution-id ID` reuses a still-running attempt for lost-reply recovery;
omit it for a new child. Exact resolved options are retained as `launchOptions`.

The brief is text, appended after a generated preamble carrying work/run IDs,
frozen roles, selected skills and any frozen reviewer instructions. The board
supplies `LAR_FACTORY_BIN`, `LAR_FACTORY_SHAPE_SKILL` and
`LAR_FACTORY_BUILD_SKILL` alongside its existing CLI/data environment. The command
checks these absolute paths and carries them, the data folder and any Azure
read-only setting into the child. Missing entries hold; global skills are never
discovered as a fallback.

Pass the launch JSON to `delegate_task` unchanged. After completion, save T3's
task result and run:

```sh
lar-work role-finish WORK_ID --execution-id ID --file result.json
```

Without `--file`, the result is read from stdin; `--file -` also reads stdin.
Both commands accept a plain T3 payload or its `structuredContent` envelope.
Finish uses only T3's `providerInstanceId`, `executedModel` (otherwise `model`),
`options`, `taskId`, `status` and `hasPendingChildRuns`. It records the report and
compares provider, effective model and every launch option, independent of option
order. A failed task, pending child, missing/malformed evidence, mismatch or
unavailable capability records failure, sets Needs you and exits 1 with the hold
reason. Stop on non-zero; cancel a mismatched active child. These commands read
the current work revision for each write; callers do not manage revisions.

## Requested and reported execution

`lar-work start-role-run WORK_ID --revision N --file F` takes
`{runId, executionId, role, threadId?, taskId?, launchOptions?}`. `role` is `thread`, a factory
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
Requested and actual differences are preserved for inspection; the board validates capabilities, checks T3's reported selection and holds mismatches.
A thread role entry records its launch attempt, not completion of the whole workflow.
Child roles record completion through the shared orchestration contract. Completion is
immutable; an identical replay is a no-op. Each changed write requires the current
work revision and bumps it once. Read the work record for the next revision.

## Review linkage

`record-review-round` accepts `runId`. For a record with snapshots, it must name
an existing build run belonging to that work record. Each reviewer also supplies
`selection: {triggerVersion: 1 | 2, outcome, rule, evidence, reason, run}` from the
versioned matcher (version 2 scopes Verify returns to the last reviewed head;
the frozen version-1 predicates stay unchanged). `run` must agree with the verdict; `outcome` is `matched`,
`unmatched` or `uncertain`. Skips keep their reason and trigger evidence.
Escalation provenance remains separate, preserving the original trigger result.

Round validation uses the snapshot's reviewer set and modes, so subsequent edits
cannot remove a custom reviewer or change a running build's never policy.
`review-rounds` returns the link and selection evidence. Legacy rounds keep their
existing JSON shape and have no invented run ID. Use `select-reviewers WORK_ID --base SHA --head SHA --run-id RUN_ID`. It selects
from the frozen settings and returns the frozen instruction text and role target.
Omitting the run ID is refused once a work record has snapshots.
