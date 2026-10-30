# Provider write permissions for users who don't maintain the repository

Research for #684, part of #653. Question: what can a user without maintainer
rights write on GitHub and Azure DevOps, and how does the factory notice a
refused write before or after it tries?

All sources were read on 2026-10-30. Lines marked "live" come from read-only
calls made with the local `gh` and `az` logins. No call wrote to any repository
or work item.

## Answer

On GitHub, any signed-in user can open an issue, comment and edit their own
issue in a public repository whose issues are on. Labels, assignees, sub-issues
and blocked-by links need the triage role, which another owner's repository
rarely grants. Editing someone else's issue body needs triage or write
depending on which doc you read, so the factory should ask the issue itself
through `viewerCanUpdate`.

On Azure DevOps there is no public write path. Public projects are being
retired, and every write needs project membership plus "Edit work items in this
node" on the work item's area path, which the Contributors group has by default.
A Contributor can comment, edit descriptions, add child and predecessor links and
assign existing tags. A new tag name also needs "Create tag definition", which
Contributors have and Stakeholders don't.

Both providers let the factory check before writing. GitHub exposes per-issue
`viewerCan*` booleans in GraphQL. Azure DevOps answers a yes or no per security
bit through the Permissions API, and Work Items Update has a `validateOnly`
dry run. After writing, GitHub's REST API does not always return an error: it
silently drops labels, assignees, milestone and type the caller may not set.
The factory has to compare the response with the request.

## GitHub

### What each write needs

GitHub's roles table lists read, triage, write, maintain and admin [1]. A
signed-in user with no role on another owner's public repository has read (live: `viewerPermission` on `cli/cli` is `READ`).
Repositories owned by a personal account have no triage role: only the owner
and collaborators, and collaborators can manage issues and labels [2].

| Write | Least role | Another owner's public repository, no role | Notes |
| --- | --- | --- | --- |
| Create an issue | Read | Yes | "People with read access can create an issue in a repository where issues are enabled" [3]. Returns 410 if issues are off [4]. |
| Comment on an issue | Read | Yes, unless locked | The `READ` permission "can also open and comment on issues" (live, `RepositoryPermission` enum). On a locked issue only people with write access and collaborators can comment [5]. Interaction limits can also restrict users without write access for a set time [6]. |
| Edit the body of the user's own issue | Read (author) | Yes | "Issue owners and users with push access or Triage role can edit an issue" [4]. |
| Edit the body of someone else's issue | Triage or write | No | REST docs say push access or triage [4]. The help page says "people with write access or higher" in organization repositories and collaborators in personal-account repositories [7]. The two disagree on triage, so the factory should read `viewerCanUpdate`. |
| Add a sub-issue | Triage | No | "People with at least triage permissions for a repository can add sub-issues" [8]. Up to 100 sub-issues per parent and eight levels [8]. |
| Add a blocked-by dependency | Triage | No | "People with at least triage permissions for a repository can create issue dependencies" [9]. |
| Apply labels | Triage | No | "Apply/dismiss labels" is triage and up [1]. Creating a new label is write and up [1]. |
| Set assignees | Triage | No | "Close, reopen, and assign all issues and pull requests" is triage and up [1]. Anyone can have an issue assigned to them [1], but only someone with triage can set it. |

### Cross-repository sub-issues and dependencies

The Add sub-issue endpoint says "The sub-issue must belong to the same
repository owner as the parent issue" [10]. The web flow lets the user pick
issues "from other repositories" [8]. So a sub-issue may sit in another
repository of the same owner, but not under another owner. The docs only name
the triage requirement for "a repository" and don't say whether the sub-issue's
repository also needs triage.

For dependencies, `gh issue create --blocked-by` and `gh issue edit
--add-blocked-by` accept issue URLs, and the docs' sample output shows a
dependency written as `octo-org/octo-repo#200` [9]. The REST and GraphQL inputs
take an issue ID (`issue_id`, `blockingIssueId`), not a repository-scoped number
[11] (live, `AddBlockedByInput`). No doc says whether a dependency may cross
owners or which repository's role GitHub checks. Settling either point needs a
write in a test repository.

### Fine-grained tokens

Every write in the table needs the repository "Issues" permission at write for a
fine-grained token [12]. This adds to the role above and doesn't replace it. On a
403 for a token permission, GitHub sends `X-Accepted-GitHub-Permissions` with the
permissions the endpoint accepts [13]. The factory uses the local `gh` login, so
this only matters if a user's `gh` runs on a fine-grained token.

### Checking before writing

| Check | Where | What it answers |
| --- | --- | --- |
| `Repository.viewerPermission` | GraphQL | `ADMIN`, `MAINTAIN`, `WRITE`, `TRIAGE_PLUS`, `TRIAGE` or `READ` (live). Returns null for a GitHub App. |
| `permissions` on `GET /repos/{owner}/{repo}` | REST | `{admin, maintain, push, triage, pull}` booleans (live: `cli/cli` gave only `pull: true`). |
| `Repository.viewerCanCreateIssues`, `hasIssuesEnabled`, `isArchived`, `interactionAbility` | GraphQL | Whether an issue can be opened right now (live). |
| `Issue.viewerCanUpdate`, `viewerDidAuthor`, `viewerCannotUpdateReasons` | GraphQL | Whether the viewer can edit this issue's title and body, and why not. Reasons include `INSUFFICIENT_ACCESS`, `LOCKED`, `ARCHIVED` and `LOGIN_REQUIRED` (live). |
| `Issue.viewerCanLabel`, `viewerCanAssign`, `viewerCanClose`, `viewerCanSetMilestone`, `viewerCanType` | GraphQL | Per-issue answers for each metadata write (live). |
| `Issue.viewerCanUpdateMetadata` | GraphQL | Triage or higher on the base role. Its description says it "does not account for individual fine-grained permissions granted via custom repository roles" (live). Nothing finer exists for sub-issues and dependencies, so this is the closest pre-check for them. |
| `Issue.locked` | GraphQL | Whether only write and collaborators may comment [5]. |
| `GET /repos/{owner}/{repo}/issues/{n}/assignees/{user}` | REST | 204 if the user can be assigned, 404 if not [14]. |

A live run on `cli/cli` issue 14874, with read only, returned
`viewerCanUpdate`, `viewerCanUpdateMetadata`, `viewerCanLabel`,
`viewerCanAssign` and `viewerCanClose` all false, with
`viewerCannotUpdateReasons: ["INSUFFICIENT_ACCESS"]`.

### What a refused write returns

| Case | Result |
| --- | --- |
| Labels, assignees, milestone or type on create or update, without push access | Request succeeds (201 or 200). The fields are "silently dropped" [4]. Add assignees is "silently ignored" for anyone ineligible and documents only 201 [14]. The factory must compare the returned `labels` and `assignees` with what it sent. |
| Issues disabled | 410 Gone [4]. |
| No access, or a private repository | 403, or 404 where GitHub hides that a private resource exists [13]. |
| Validation failure or spam detection | 422 with an `errors` array whose items have a `code` such as `missing`, `invalid` or `custom` [13]. |
| Sub-issue or dependency add | Documented codes are 201, 403, 404, 410 and 422 [10] [11]. |
| GraphQL | HTTP 200 with an `errors` array. A read for a missing issue returned `{"type": "NOT_FOUND", "path": [...], "message": "..."}` (live). The `type` a permission refusal returns was not confirmed without a write. |

## Azure DevOps

### Who counts as a contributor

Azure DevOps public projects are retired, and "starting in 2027, existing public
projects convert to private" [15]. A user who doesn't belong to the project can't
write. A member's writes depend on the access level (Stakeholder or Basic) and on
security groups (Readers, Contributors, Project Administrators) [16]. The
"ordinary contributor" in #653 is a Basic member of Contributors.

Work item writes are checked against the work item's area path, in the CSS
security namespace [17]. Tag creation is checked in the Tagging namespace [17].
Bits below are from a live read of both namespaces.

| Permission | Namespace and bit | Default holders |
| --- | --- | --- |
| View work items in this node | CSS `WORK_ITEM_READ` 16 | Readers, Contributors, Project Administrators [16] |
| Edit work items in this node | CSS `WORK_ITEM_WRITE` 32 | Contributors, Project Administrators [16] |
| Edit work item comments in this node | CSS `WORK_ITEM_SAVE_COMMENT` 512 | "Not set" when introduced [18]. The defaults table lists Contributors and Project Administrators [16]. |
| Create tag definition | Tagging `Create` 2 | Contributors, Project Administrators [16] [19] |

CSS namespace ID `83e28ad4-2d72-4ceb-97b0-c7726d5502c3`, token
`vstfs:///Classification/Node/{area node id}`. Tagging namespace ID
`bb50f182-8e5e-40b8-bc21-e8752a1e7ae2`, token `/{project id}` [17].

### What each write needs

| Write | Contributor (Basic) | Stakeholder | Reader | Needs |
| --- | --- | --- | --- | --- |
| Add a comment | Yes | Yes [16] | No | Edit work items in this node, or Edit work item comments in this node alone. The second lets a user "add comments, but unable to update any of the other fields" [18]. Add Comment needs the `vso.work_write` scope and is still `7.1-preview.4` [20]. |
| Edit the description | Yes | Yes [21] | No | Edit work items in this node on the item's area path [22]. Work item rules may still block a field [16]. |
| Add a child link | Yes | Through the form; the backlog Mapping pane is blocked [21] | No | Edit work items in this node [22]. Relation `System.LinkTypes.Hierarchy-Forward` (live). |
| Add a predecessor link | Yes | Through the form | No | Edit work items in this node [22]. Relation `System.LinkTypes.Dependency-Reverse` (live). |
| Add an existing tag | Yes | Yes, "assign existing tags" [21] | No | Edit work items in this node. Denying Create tag definition "doesn't prevent them from assigning existing tags to work items that they can edit" [19]. |
| Add a new tag | Yes | No, "add new work item tags" is on the can't list [21] | No | Basic access and Create tag definition [19]. |

Links to work items in another project of the same organization use the same
link types. Links to another organization need the remote link types
(`Remote Related`, `Consumes From`, `Produces For`), and both organizations must
use the same Microsoft Entra ID [22]. The docs only state the edit permission on
the item being edited. Whether a parent and child link also checks the other
item's area path was not confirmed without a write.

### Checking before writing

| Check | Call | What it answers |
| --- | --- | --- |
| One security bit for the caller | `GET {org}/_apis/permissions/{namespaceId}/{bits}?tokens={token}` | `{"count": 1, "value": [true]}` per token (live). |
| Edit work items on the item's area | CSS namespace, bit 32, the area node's token | Comments, description, links and existing tags. |
| Comment-only permission | CSS namespace, bit 512 | Whether a user without bit 32 can still comment. |
| Create a tag | Tagging namespace, bit 2, `/{project id}` | Whether a new tag name will be accepted. |
| Does the tag already exist | `GET {org}/{project}/_apis/wit/tags` | List of tag definitions (live). If the tag exists, Create isn't needed. |
| Dry run of a field, tag or link change | `PATCH .../wit/workitems/{id}?validateOnly=true` | "Validate the changes without saving the work item" [23]. Runs rules too. |

A live run with the local login returned true for CSS bit 32 and
Tagging bit 2 on the project's root area, and false for CSS bit 512. Bit 512
being unset doesn't stop that user from commenting, because bit 32 covers it.
The factory should check bit 32 first and fall back to bit 512 only for
comments.

The live token covered only the root area node. The namespace reference shows
nested iteration tokens as a colon-joined chain of node tokens [17]. The factory
should build the chain from the item's area path, since a child node may deny
what the root allows.

### What a refused write returns

Errors share one JSON shape (live, from a read of a missing work item):
`{"$id", "innerException", "message", "typeName", "typeKey", "errorCode",
"eventId"}`. That read returned 404 with `typeKey`
`WorkItemUnauthorizedAccessException` and message `TF401232: Work item ... does
not exist, or you do not have permissions to read it.` Azure DevOps uses the
same 404 for a missing item and an unreadable one.

The REST docs for Work Items Update and Add Comment document only the success
response [20] [23]. The status code and `typeKey` for a refused edit, a refused
comment and a refused new tag were not confirmed without a write. They need a
test in a sandbox project with a Readers member and a Stakeholder. The factory
should treat any non-2xx from a write as refused, and key on `typeKey` once those
values are known.

## Open points

These need a write in a test repository or project:

1. GitHub: which repository's triage role a cross-repository sub-issue or
   dependency checks, and whether a dependency may cross owners.
2. GitHub: the GraphQL error `type` for a refused `addSubIssue`, `addBlockedBy`
   or `addLabelsToLabelable`.
3. Azure DevOps: the status code and `typeKey` for a refused update, comment and
   new tag, and whether `validateOnly=true` reports permission refusals or only
   rule failures.
4. Azure DevOps: whether a child or predecessor link needs edit permission on the
   target item's area path as well.

## Sources

1. GitHub Docs, [Repository roles for an organization](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization), permissions table.
2. GitHub Docs, [Permission levels for a personal account repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository), collaborator access.
3. GitHub Docs, [Creating an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue), permissions line.
4. GitHub REST, [Issues: create an issue, update an issue](https://docs.github.com/en/rest/issues/issues).
5. GitHub Docs, [Locking conversations](https://docs.github.com/en/communities/moderating-comments-and-conversations/locking-conversations).
6. GitHub Docs, [Limiting interactions in your repository](https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository).
7. GitHub Docs, [Editing an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue), permissions line.
8. GitHub Docs, [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues), permissions line and limits.
9. GitHub Docs, [Creating issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies), permissions line and CLI section.
10. GitHub REST, [Sub-issues: add sub-issue](https://docs.github.com/en/rest/issues/sub-issues).
11. GitHub REST, [Issue dependencies: add a dependency an issue is blocked by](https://docs.github.com/en/rest/issues/issue-dependencies).
12. GitHub REST, [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens), "Issues" section.
13. GitHub REST, [Troubleshooting the REST API](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api).
14. GitHub REST, [Assignees](https://docs.github.com/en/rest/issues/assignees).
15. Microsoft Learn, [Stakeholder access quick reference](https://learn.microsoft.com/en-us/azure/devops/organizations/security/stakeholder-access), "Important" note on public projects.
16. Microsoft Learn, [Default permissions and access for Azure Boards](https://learn.microsoft.com/en-us/azure/devops/boards/get-started/permissions-access-boards).
17. Microsoft Learn, [Security namespace and permission reference](https://learn.microsoft.com/en-us/azure/devops/organizations/security/namespace-reference), CSS, Iteration and Tagging rows.
18. Microsoft Learn, [Azure Boards Sprint 216 update: new save comments permission](https://learn.microsoft.com/en-us/azure/devops/release-notes/2023/boards/sprint-216-update).
19. Microsoft Learn, [Set permissions for work tracking](https://learn.microsoft.com/en-us/azure/devops/organizations/security/set-permissions-access-work-tracking), "Set work item tag permissions".
20. Azure DevOps REST, [Comments: add work item comment](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add-work-item-comment?view=azure-devops-rest-7.1).
21. Microsoft Learn, [Stakeholder access quick reference](https://learn.microsoft.com/en-us/azure/devops/organizations/security/stakeholder-access), Azure Boards table.
22. Microsoft Learn, [Link work items to objects](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/add-link), prerequisites and remote links.
23. Azure DevOps REST, [Work items: update](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1), URI parameters.
