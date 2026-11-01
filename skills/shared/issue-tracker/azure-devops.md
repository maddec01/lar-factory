# Azure DevOps

[Work records](work-records.md) hold the factory's work on every provider. This
file covers what differs when a repository's origin is on Azure DevOps.

## Azure DevOps

A repository on Azure DevOps takes its tickets from work items in its project:
its team's backlog and current sprint. Read them with the local `az login` and
the `azure-devops` extension. When `az` says it is logged out, run `az login`;
when it doesn't know `boards`, run `az extension add --name azure-devops`. Then
rerun.

Take the organization and project from the origin
(`https://dev.azure.com/<org>/<project>/_git/<repo>`; `scripts/azure.sh` lists
the other forms), with the project name as Azure shows it, `%20` turned back
into a space. A work item's id ends its URL
(`https://dev.azure.com/<org>/<project>/_workitems/edit/<id>`). A record keeps
a picked work item as `<org>/<project>/<repo>#<id>`, and `work.sh` and
`status.sh` take the work item's URL.

Pass `--organization "$org"` to every command and `--api-version` to every
`az devops invoke`, which otherwise defaults to 5.0. Read a work item and its
comments:

```sh
org=https://dev.azure.com/<org>
project="<project>"
az boards work-item show --id "$id" --expand all --organization "$org"
az devops invoke --area wit --resource comments --organization "$org" \
  --route-parameters project="$project" workItemId="$id" --api-version 7.1-preview.4 \
  --query 'comments[].{by: createdBy.displayName, date: createdDate, text: text}'
```

Queue, Status and shaping or build progress live only in local work records.
[Tracker structure sync](publication.md) saves concept and multi-repository kind,
map diagram, parts, Connections, Dependencies and issue grouping when the local
option is ON. That path saves only shaping results needed for structure.
[Issue creation and Ticket Specs](work-records.md#issue-creation) use independent
ON-by-default settings. The whole gated brief, including enabled Domain docs,
becomes the main text with the earlier text kept as Original. Decisions, slices,
queue and progress stay local. The source supplies List without a per-ticket
import step. Keep workflow labels, progress comments and Azure State unchanged.

Spec writes convert Markdown to HTML, preserve Original HTML and the managed
structure block, and test the work-item revision. Bugs use Repro Steps for creates
and Specs, leaving a separate Description intact. A visible Original heading
supports sanitizers that strip comments or details. Member edits sync back to the
record, with HTML conversion only after a real text edit. Preserve teammates'
raw HTML outside managed structure when syncing structure. Respect the sync
command's recorded outcomes and reconcile uncertainty before retrying. The saved onboarding option
covers structural sync without repeated per-update approval prompts.

Build PRs use the native work-item relationship through
[PR delivery](publication-pr.md). Preserve the team's PR completion settings.
Only the user marks a local Dependency met; a work-item State proves no contract
or deployment.

## Read-only environments

Respect `LAR_FACTORY_AZURE_READ_ONLY=1` for live reads; it grants no write
permission. Verified Access controls writes for every organization and project.
Development and script tests use fake providers.
