# Running the factory on Azure DevOps through the az login

Research for [#350](https://github.com/maddec01/mux-factory/issues/350), part of the #70 map. It
feeds [#359](https://github.com/maddec01/mux-factory/issues/359) (provider and list source) and
[#360](https://github.com/maddec01/mux-factory/issues/360) (label set).

Sources are Microsoft Learn pages for the Azure CLI's `azure-devops` extension and the Azure DevOps
REST API, read on 2026-10-25, and T3 Code at `pingdotgg/t3code` commit
[`5b35402`](https://github.com/pingdotgg/t3code/tree/5b35402623d7d1d88eaa472807272a6c2e78012a)
(main on 2026-10-25). The factory side was read at `origin/main`: it reads one user-owned GitHub
Project through `gh api graphql` (`apps/server/src/github/github.ts`), as
[ADR 0001](../adr/0001-use-the-local-gh-login.md) records. "Unconfirmed" marks a claim no primary
source states outright.

## Summary

- `az login` is enough. The `az devops`, `az boards`, `az repos` and `az pipelines` commands accept
  it, so the factory can keep its "local login, no secrets" rule. Guest users need a PAT, and the
  extension doesn't support Azure DevOps Server (on-premises).
- `az boards` can create, show and update work items, set tags through `System.Tags`, and add and
  list links. It can't read or write comments, run tree queries or fetch work items in a batch.
  `az devops invoke` reaches any REST endpoint with the same login and covers all three.
- Children are `System.LinkTypes.Hierarchy-Forward` links, and each item has one parent. A blocker
  is a Predecessor (`System.LinkTypes.Dependency-Reverse`) link. Task is the child type under
  User Story (Agile), Product Backlog Item (Scrum) and Issue (Basic).
- A sprint list takes three calls. `az boards iteration team list --timeframe current` finds the
  sprint, `list-work-items` returns IDs and parent links only, and `workitemsbatch` reads up to 200
  items' fields per call. The board's config would need organization, project and team.
- State names differ by process (Agile, Scrum, Basic), but every state belongs to one of five
  categories: Proposed, In Progress, Resolved, Completed, Removed. A states endpoint returns each
  type's states with their categories, so the board can read them instead of hard-coding them.
- Labels map to tags. A tag is case sensitive, at most 400 characters, can't contain `,` or `;`,
  and an item holds at most 100. Contributors can create tags by default. Area paths are a
  single-valued alternative that needs admin rights to create.
- Azure Repos PRs link to work items with `--work-items` or `Fixes #123` in the description, and
  completing a PR can move linked items to their Completed state. Checks are branch policies,
  read with `az repos pr policy list`.
- T3 Code's Azure DevOps support is pull requests only, through `az repos` and `az devops invoke`.
  It reads no work items, boards or sprints, and its PR detail returns no checks.

## The az login

The CLI accepts the interactive Entra sign-in: "If you already signed in interactively with
`az login`, you don't need to provide a PAT. The `az devops` commands support sign-in through
`az login`." Guest users are the exception: "For Guest Users, only `az devops login` is supported."
A PAT can also come from `az devops login` or the `AZURE_DEVOPS_EXT_PAT` variable, which the CLI
uses only "if you haven't used `az login` or `az devops login`"
([log in via PAT](https://learn.microsoft.com/en-us/azure/devops/cli/log-in-via-pat)).

- Install: `az extension add --name azure-devops`. The reference pages say the extension also
  installs itself "the first time you run an az devops command"
  ([CLI overview](https://learn.microsoft.com/en-us/azure/devops/cli/),
  [az boards](https://learn.microsoft.com/en-us/cli/azure/boards)).
- "The Azure DevOps CLI extension works only with Azure DevOps Services (cloud). It doesn't support
  Azure DevOps Server (on-premises)" ([CLI overview](https://learn.microsoft.com/en-us/azure/devops/cli/)).
- Defaults: `az devops configure --defaults organization=https://dev.azure.com/contoso project=X`.
  Inside a clone, `--detect true` will "Automatically detect organization", and the project is
  "picked up via git config" when no default is set
  ([az repos pr](https://learn.microsoft.com/en-us/cli/azure/repos/pr)).
- `az devops invoke --area --resource --route-parameters --query-parameters --http-method --in-file
  --api-version` "will invoke request for any DevOps area and resource". Its `--api-version`
  defaults to 5.0, so every call should pass one ([az devops](https://learn.microsoft.com/en-us/cli/azure/devops)).
  No page says in so many words that `invoke` works with an `az login` session alone, but T3 Code
  relies on exactly that (see [T3 Code](#what-t3-codes-azure-support-covers)).
- For plain REST, `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`
  returns an Entra token that lasts one hour
  ([Entra tokens](https://learn.microsoft.com/en-us/azure/devops/cli/entra-tokens)), and
  `az rest --resource 499b84ac-...` sends one for you
  ([Entra service connection example](https://learn.microsoft.com/en-us/azure/devops/pipelines/library/add-devops-entra-service-connection)).
- Unconfirmed: whether a personal Microsoft account (MSA) can use browser `az login` against an
  organization not backed by Entra ID. The only MSA statement found is that
  `az login --username/--password` "doesn't work with Microsoft accounts"
  ([sign in interactively](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively)).
- Throttling: "The global limit is 200 TSTUs within any sliding five-minute window", where one TSTU
  is a typical user's load over five minutes. Over the limit, calls are delayed up to 30 seconds or
  blocked with HTTP 429. Clients should honour `Retry-After` and read `X-RateLimit-Remaining`
  ([rate limits](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits)).

## Reading and writing work items

The CLI commands, from [az boards work-item](https://learn.microsoft.com/en-us/cli/azure/boards/work-item):

| Command | Flags that matter |
| --- | --- |
| `az boards work-item create` | `--title --type [--description] [--area] [--iteration] [--assigned-to] [--discussion] [--fields "f=v" ...] [--reason]` |
| `az boards work-item update --id` | `[--state] [--reason] [--title] [--description] [--area] [--iteration] [--discussion] [--fields]` |
| `az boards work-item show --id` | `[--expand {all,fields,links,none,relations}]` (default `all`), `[--fields]`, `[--as-of]` |
| `az boards work-item delete --id` | `[--destroy]` deletes permanently |
| `az boards query` | `[--wiql] [--id] [--path]`; "Only supports flat queries" ([az boards](https://learn.microsoft.com/en-us/cli/azure/boards)) |

- Fields go by reference name: `System.Title`, `System.State`, `System.WorkItemType`, `System.Tags`,
  `System.AreaPath`, `System.IterationPath`. `System.Parent` is an integer holding the parent's ID
  ([linking fields](https://learn.microsoft.com/en-us/azure/devops/boards/queries/linking-attachments)).
  A REST work item is `{id, rev, fields, relations: [{rel, url, attributes}]}`
  ([get work items batch](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch)).
  Unconfirmed: that the CLI prints exactly this shape; its pages show no sample output.
- WIQL returns IDs only: "The API only returns work item IDs, regardless of which fields you include
  in the `SELECT`" ([WIQL syntax](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax)).
  Results stop at 20,000 items with no error
  ([object limits](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/object-limits)).
- Fields for many items come from `POST {org}/{project}/_apis/wit/workitemsbatch` with `ids`,
  `fields` and `$expand`, at most 200 IDs per call
  ([get work items batch](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch)).
  The CLI has no batch command, so this goes through `az devops invoke`.
- Markdown in Description: add `{"op": "add", "path": "/multilineFieldsFormat/System.Description",
  "value": "markdown"}` to the JSON patch on `PATCH .../_apis/wit/workitems/{id}?api-version=7.2-preview.3`
  ([update work item](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.2)).
  Unconfirmed: whether `--description` on the CLI can set markdown; it likely writes HTML.

### States per process

| Process | Requirement type | Its states | Task states | Other types |
| --- | --- | --- | --- | --- |
| Basic | Issue | To Do, Doing, Done | To Do, Doing, Done | Epic |
| Agile | User Story | New, Active, Resolved, Closed, Removed | New, Active, Closed, Removed (unconfirmed) | Epic, Feature, Bug, Issue |
| Scrum | Product Backlog Item | New, Approved, Committed, Done, Removed | To Do, In Progress, Done, Removed (only To Do confirmed in text) | Epic, Feature, Bug, Impediment |
| CMMI | Requirement | Proposed, Active, Resolved, Closed | | Epic, Feature, Bug, Change Request, Issue, Risk, Review |

Source: [choose a process](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/choose-process).
The Task states for Agile and Scrum appear only in the page's diagrams, so the board should read
them rather than trust this table.

- Every state maps to one category: Proposed, In Progress, Resolved, Completed or Removed. "Each
  work item type can have only one state mapped to [Completed]"
  ([state categories](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/workflow-and-state-categories)).
- `GET {org}/{project}/_apis/wit/workitemtypes/{type}/states?api-version=7.1` returns
  `[{name, color, category}]` ([work item type states](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-states/list)).
  Processes can be customised, so reading this is safer than a per-process table.
- Each process has three backlog levels: portfolio (Epic, Feature), requirement (Issue, User Story,
  PBI or Requirement) and task (Task)
  ([choose a process](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/choose-process)).

### Tags

- Tags live in `System.Tags` as one string, for example `"Tag0; Tag1; Tag2"`. A JSON-patch `add`
  appends to the list and `replace` overwrites it
  ([update work item](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.2)).
  Unconfirmed: how to remove one tag (presumably `replace` with the rest) and whether
  `--fields System.Tags=...` on the CLI appends or replaces. The CLI has no tag commands.
- Rules: "Tags should be 400 characters or less and not contain separators such as a `,` (comma),
  `;` (semicolon)". "Tags are case sensitive." At most 100 tags per work item. Tags starting with
  `@` can't be queried, and "You can't query for work items that don't have any tags"
  ([add tags](https://learn.microsoft.com/en-us/azure/devops/boards/queries/add-tags-to-work-items)).
  Unconfirmed: whether a colon, as in `decision: research`, causes trouble. The page names only
  commas and semicolons.
- Creating a new tag needs the project-level "Create tag definition" permission, which Contributors
  have by default (same page). An organization holds at most 150,000 tag and PR label names
  ([object limits](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/object-limits)).
- WIQL: `[System.Tags] CONTAINS 'security'`
  ([WIQL syntax](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax)).
  The tags REST API lists, renames and deletes tags; deleting one removes it from every work item
  and PR ([tags](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/tags?view=azure-devops-rest-7.2)).
- Area paths (`System.AreaPath`) are the other option for an "area". Each item has exactly one, and
  creating one needs Project Administrator or "Create child nodes" rights
  ([area paths](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/set-area-paths)).
  They also decide which team's backlog shows the item.

### Comments

- `az boards` has no comments command. `--discussion` on create and update adds "Comment to add to
  a discussion in a work item" ([az boards work-item](https://learn.microsoft.com/en-us/cli/azure/boards/work-item)).
  In the web form, discussion text goes to `System.History`
  ([Agile workflow](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/agile-process-workflow));
  unconfirmed for the CLI flag.
- REST add: `POST {org}/{project}/_apis/wit/workItems/{id}/comments?format=markdown&api-version=7.2-preview.4`
  with body `{text}` ([add work item comment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-work-item-comment?view=azure-devops-rest-7.2)).
  List: `GET .../comments?$top=&continuationToken=&order=` returns `totalCount` and a continuation
  token ([get comments](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/get-comments?view=azure-devops-rest-7.1)).
  Update and delete exist too ([comments](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments?view=azure-devops-rest-7.1)).
- Markdown comments became generally available in Sprint 259, July 2025
  ([release notes](https://learn.microsoft.com/en-us/azure/devops/release-notes/2025/boards/sprint-259-update)).

## Child items and blockers

`az boards work-item relation add --id --relation-type --target-id`, `relation remove`,
`relation show --id` and `relation list-type` manage links
([relation](https://learn.microsoft.com/en-us/cli/azure/boards/work-item/relation)). `--relation-type`
takes the friendly names from `list-type`:

| Friendly name | Reference name | Meaning for item A linking to B |
| --- | --- | --- |
| Child | `System.LinkTypes.Hierarchy-Forward` | B is A's child |
| Parent | `System.LinkTypes.Hierarchy-Reverse` | B is A's parent |
| Predecessor | `System.LinkTypes.Dependency-Reverse` | B blocks A |
| Successor | `System.LinkTypes.Dependency-Forward` | A blocks B |
| Related | `System.LinkTypes.Related` | No direction |

Source: [link type reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference),
which says "Choose **Predecessor** when linking to a work item that should complete before the
current item." The [WIQL page](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax)
spells the dependency names `Dependency-Predecessor` and `Dependency-Successor`, which disagrees with
`list-type`; the `list-type` output is the one to trust.

- "A work item can have only one Parent. A parent work item can have many children." Parent-child
  is a tree with no cycles, and circular dependency links raise an error. Microsoft recommends
  keeping parent-child links in one project; predecessor and successor links can cross projects
  ([link type reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference)).
  An item holds at most 1,000 links
  ([object limits](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/object-limits)).
- Child type: Task sits under User Story, PBI or Issue
  ([plan and track work](https://learn.microsoft.com/en-us/azure/devops/boards/get-started/plan-track-work)).
  Boards "expects a natural hierarchy". Same-type parent links work but stop the backlog from
  reordering them, and sprint boards show only leaf items
  ([backlog reorder issues](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/resolve-backlog-reorder-issues)).
  No page says Boards rejects a cross-type parent link.
- Listing children and blockers: `az boards work-item show --id N --expand relations` and filter
  `relations[].rel` for `Hierarchy-Forward` (children) or `Dependency-Reverse` (blockers). The
  target ID is the last segment of each `url`. Their states then need a batch read.
- One query for a whole tree: `SELECT ... FROM workItemLinks WHERE [System.Links.LinkType] =
  'System.LinkTypes.Hierarchy-Forward' ... MODE (Recursive)`
  ([WIQL syntax](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax)). The
  CLI's `az boards query` is flat-only, so tree queries go through `az devops invoke` to
  `POST {org}/{project}/{team}/_apis/wit/wiql`
  ([query by WIQL](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql)).
- Across organizations, only the remote link types work (`System.LinkTypes.Remote.Dependency-*`,
  `Remote.Related`), and only when "the same Microsoft Entra ID manages those organizations"
  ([link type reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference)).

## Sprints as a list source

- `az boards iteration team list --team T --timeframe current` returns the current sprint; the
  flag's help says "Only Current is supported currently". Then
  `az boards iteration team list-work-items --id <iteration id> --team T` lists its work items
  ([iteration team](https://learn.microsoft.com/en-us/cli/azure/boards/iteration/team)).
- The REST equivalents are `GET {org}/{project}/{team}/_apis/work/teamsettings/iterations?$timeframe=current`
  ([iterations list](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list))
  and `GET .../iterations/{id}/workitems`. The second returns only `workItemRelations`: top-level
  items with `rel: null` and parent-child pairs with `rel: "System.LinkTypes.Hierarchy-Forward"`
  ([get iteration work items](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/get-iteration-work-items)).
  Fields need a second call to `workitemsbatch`.
- WIQL `[System.IterationPath] = @CurrentIteration('[Project]\Team')` is documented on the
  [WIQL page](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax), but
  [another page](https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-by-area-iteration-path)
  says direct WIQL/REST calls "don't accept raw macro tokens". Unconfirmed which is right; using the
  path from `$timeframe=current` avoids the question.
- A sprint belongs to a team. "Each new project is configured with a default team named after the
  project", and "Each team owns its own backlog"
  ([teams](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/about-teams-and-settings)).
  The team's area paths come from `GET .../{team}/_apis/work/teamsettings/teamfieldvalues`
  ([team field values](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/teamfieldvalues/get)).
- Board columns are per team and map to states:
  `GET .../{team}/_apis/work/boards/{board}/columns` returns each column's `stateMappings`
  ([columns](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/columns/list)).
  "Unmapped states don't appear on the board", and the Completed state "can only map to the last
  board column" ([add columns](https://learn.microsoft.com/en-us/azure/devops/boards/boards/add-columns)).
  The `System.BoardColumn` field can't be set from the form and can change when another team moves
  the item ([workflow fields](https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-by-workflow-changes)),
  so state, not column, is the stable place for status.
- The team backlog (`GET .../{team}/_apis/work/backlogs/{backlogId}/workItems`) is another list
  source, also IDs only ([backlog work items](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/backlogs/get-backlog-level-work-items)).

## Pull requests and checks in Azure Repos

- Create: `az repos pr create --source-branch --target-branch --title --description --work-items
  [--draft] [--auto-complete] [--delete-source-branch] [--squash] [--transition-work-items]
  [--labels]`. `--transition-work-items` moves linked items "into the next logical state. (e.g.
  Active -> Resolved)" and defaults to false
  ([az repos pr](https://learn.microsoft.com/en-us/cli/azure/repos/pr)).
- Update: `az repos pr update --id --status {abandoned, active, completed} [--auto-complete]
  [--draft] [--transition-work-items]`. List: `--status --source-branch --target-branch --creator
  --reviewer`; there is no work-item filter (same page).
- Linking: `az repos pr work-item add|list|remove --id --work-items`
  ([pr work-item](https://learn.microsoft.com/en-us/cli/azure/repos/pr/work-item)), or
  `workItemRefs` in the REST create body
  ([create PR](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create)).
- Closing on merge: `Fixes #456` in an Azure Repos PR description "Transitions work item 456 to
  the appropriate completed state", and `Resolves` and `Closes` work too. The "Complete linked work
  items after merging" checkbox at completion remembers each user's last choice. Nothing moves if
  the item is already Resolved or Completed or a workflow rule blocks it
  ([auto-complete work items](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/auto-complete-work-items-pull-requests)).
  The repository settings "Commit mention linking" and "Commit mention work item resolution" are on
  by default ([repository settings](https://learn.microsoft.com/en-us/azure/devops/repos/git/repository-settings)).
- Merge state: the REST `mergeStatus` is `notSet`, `queued`, `conflicts`, `succeeded`,
  `rejectedByPolicy` or `failure`; `status` is `active`, `abandoned` or `completed`
  ([create PR](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create)).
  Auto-complete "always waits for required policies (isBlocking == true)" (same page).
- Checks are branch policies. `az repos pr policy list --id` prints `Evaluation ID | Policy |
  Blocking | Status | Expired | Build ID`
  ([pr policy](https://learn.microsoft.com/en-us/cli/azure/repos/pr/policy),
  [complete a PR](https://learn.microsoft.com/en-us/azure/devops/repos/git/complete-pull-requests)).
  The REST form is `GET {org}/{project}/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}`,
  with `status` of `queued`, `running`, `approved`, `rejected`, `notApplicable` or `broken` and
  `configuration.isBlocking` ([policy evaluations](https://learn.microsoft.com/en-us/rest/api/azure/devops/policy/evaluations/list)).
  Unconfirmed: that the build ID sits at `context.buildId`; no Learn sample shows the context keys.
- External services post PR statuses (`pending`, `succeeded`, `failed`, `error`) through
  `GET .../pullRequests/{id}/statuses`, gated by a "Status checks" policy
  ([PR statuses](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-statuses/list),
  [branch policies](https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies)).
- Builds: `az pipelines runs list` has `--branch`, `--reason`, `--result`, `--status` and no
  `--pr-id` ([pipelines runs](https://learn.microsoft.com/en-us/cli/azure/pipelines/runs)). A PR
  build runs on `refs/pull/{id}/merge`
  ([predefined variables](https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables)),
  so `--branch refs/pull/{id}/merge --reason pullRequest` should find them. Unconfirmed end to end.
  Build validation that expires "sets PR build policy status to *failed* whenever the branch is
  updated" ([branch policies](https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies)).

## GitHub repos with Azure Boards

- `az repos` manages Azure Repos only ([az repos](https://learn.microsoft.com/en-us/cli/azure/repos)).
- Azure Boards can connect GitHub repositories, each to one organization and project
  ([Boards and GitHub](https://learn.microsoft.com/en-us/azure/devops/boards/github)). Then
  `AB#123` in a commit message or PR or issue description links the item, and `Fixed AB#123` moves
  it to its first Resolved state (or Completed) once the PR merges into the default branch. Only
  the first item in `Fixes AB#123, AB#124` moves
  ([link to GitHub](https://learn.microsoft.com/en-us/azure/devops/boards/github/link-to-from-github)).
  The work item gains a GitHub Pull Request link
  ([link type reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference)).
  This is one route for #70's fog item about a GitHub build blocked by an Azure work item.
  Unconfirmed: the URL format of those GitHub links in a work item's relations.

## What T3 Code's Azure support covers

All paths are in [`packages/source-control-azure-devops`](https://github.com/pingdotgg/t3code/tree/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops)
unless noted.

- Setup is `az extension add --name azure-devops` then `az login`
  ([docs/user/source-control.md](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/docs/user/source-control.md#azure-devops)).
  T3 checks the login with `az account show --query user.name -o tsv`
  ([`AzureDevOpsSourceControlProvider.ts:48`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsSourceControlProvider.ts#L48)).
- It runs `az repos pr create|list|show|update|checkout` and `az repos show` with `--detect true`,
  taking organization and project from the checkout
  ([`AzureDevOpsCli.ts`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsCli.ts#L515-L534)).
  For threads, iterations and file contents it calls `az devops invoke --area git` at
  api-version 7.1 ([`AzureDevOpsPullRequestCli.ts:307`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestCli.ts#L307-L322)),
  which shows `invoke` works with the `az login` session.
- PR actions: merge, ready, draft, close, reopen, and turning auto-merge on and off
  ([`definition.ts:97`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/shared/definition.ts#L97-L105)).
  Comments are read-only: "For Azure DevOps, use the host website to change comments"
  ([source-control.md](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/docs/user/source-control.md)).
- Not covered: work items, boards, sprints and labels. "Azure keeps labels on work items rather
  than on the pull request", so T3 returns none
  ([`AzureDevOpsPullRequestProvider.ts:111`](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestProvider.ts#L111)).
  The PR detail sets `checks: []`
  ([line 328](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/packages/source-control-azure-devops/src/server/AzureDevOpsPullRequestProvider.ts#L328)),
  so T3 can't report Azure checks, and its PR watch can't wake an agent on a failed Azure check.
  Nothing in the package mentions work items, `az boards` or `--work-items`.
- An Azure DevOps PR can only be linked to a thread whose project is "checked out from the
  matching organization and repository" ([source-control.md](https://github.com/pingdotgg/t3code/blob/5b35402623d7d1d88eaa472807272a6c2e78012a/docs/user/source-control.md)).

## GitHub concept to Azure DevOps

| Factory concept today (GitHub) | Azure DevOps | Through |
| --- | --- | --- |
| `gh` login | `az login` (PAT for guests) | Azure CLI with `azure-devops` |
| Issue | Work item of the requirement type (User Story, PBI, Issue) | `az boards work-item` |
| Sub-issue | Task linked by `Hierarchy-Forward` | `az boards work-item relation add --relation-type child` |
| Blocked by | Predecessor link (`Dependency-Reverse`) | `relation add --relation-type predecessor` |
| Label | Tag in `System.Tags` | `--fields System.Tags=...` or JSON patch |
| Issue comment | Work item comment | `az devops invoke` to the comments API |
| Open or closed | State, read by category | `--state`; categories from the states API |
| Project Status field | No equivalent field; board columns map to states per team | States API, columns API |
| GitHub Project list | Current sprint, team backlog or WIQL query | `az boards iteration team`, `az devops invoke` |
| GraphQL batch read | `workitemsbatch`, 200 IDs per call | `az devops invoke` |
| PR closes issue | `Fixes #N` or `--work-items` plus transition on completion | `az repos pr create` |
| PR checks | Policy evaluations and PR statuses | `az repos pr policy list` |

## Open questions for Pedro

1. List source per Azure repo: the team's current sprint (needs a team name and drops items with no
   sprint), the team backlog, or a saved WIQL query?
2. Status: board statuses (List, Building, Needs you, Done) have no Azure field. Map them to state
   categories, keep them as tags, or leave status to #354?
3. Ticket type: should onboarding pick the process's requirement type (User Story, PBI, Issue) for
   tickets and Task for children, and read state names from the states API?
4. Kinds and areas: tags for all labels, or kinds as work item types and areas as area paths? Area
   paths need admin rights and allow one per item.
5. Calls: wrap `az boards` and `az repos` where they reach, and `az devops invoke` for comments,
   batch reads and tree queries, or use `az devops invoke` (or `az rest`) for everything to keep
   one JSON shape?
