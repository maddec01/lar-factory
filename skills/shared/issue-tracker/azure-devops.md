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

Status, kind, structure and blockers live in the record, never in tags, State,
child Tasks or Predecessor links. An old `repo-<repository>` tag only places
existing work when onboarding imports it.
