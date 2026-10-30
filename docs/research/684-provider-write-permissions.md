# Provider write permissions for non-maintainers

Research for [#684](https://github.com/maddec01/lar-factory/issues/684), part of [#653](https://github.com/maddec01/lar-factory/issues/653). Checked 2026-10-30. Documentation research only; no writes were attempted against external repositories or Azure projects.

## GitHub

| Operation | User rights |
| --- | --- |
| Post an issue comment | Read access allows participation. Public visibility permits participation without a collaborator role, subject to interaction restrictions and locks. [Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization), [comment API](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment). |
| Edit issue title or body | The author can edit their own issue. Editing another author's issue requires write access in an organization repository or collaborator access in a personal repository. Triage alone does not grant this. [Editing an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue). |
| Add sub-issues | At least triage. Authorship alone is insufficient. [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues). |
| Add blocked-by dependencies | At least triage. [Creating dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies). |
| Apply existing labels | Triage or higher. Creating, editing and deleting label definitions requires write or higher. [Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization). |

These organization role names are not a universal ladder for personal repositories. Public access to another owner's repository does not grant triage or write. Author rights apply to one's own content, not another author's body or its relationships. [Roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization), [editing](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue).

The REST write endpoints document fine-grained token permissions separately: issue updates, comments, sub-issues and dependencies require Issues write; label endpoints also accept Pull requests write. These requirements do not confer the user's missing repository rights. An issue update can silently ignore labels supplied by a caller without push access, so a successful request is not proof every requested field changed. Prefer dedicated label endpoints and read back the result. [Issue update](https://docs.github.com/en/rest/issues/issues#update-an-issue), [comments](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment), [sub-issues](https://docs.github.com/en/rest/issues/sub-issues), [dependencies](https://docs.github.com/en/rest/issues/issue-dependencies), [labels](https://docs.github.com/en/rest/issues/labels).

Fine-grained PATs have limitations for contributing to public repositories where the user is not a member. Do not interpret an appropriately named token permission as proof it can operate on an external public repository. [PAT limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations).

## Azure DevOps

Azure uses project access levels and area permissions rather than issue authorship or Git repository roles. Contributors normally can edit work items; Readers normally cannot. Check the item's actual area, including inherited permissions, rather than the user's group name. Creating a work item does not establish an author exception to area permissions. [Default permissions](https://learn.microsoft.com/en-us/azure/devops/organizations/security/permissions-access?view=azure-devops), [effective permissions](https://learn.microsoft.com/en-us/azure/devops/organizations/security/view-permissions?view=azure-devops).

| Operation | Permission or constraint |
| --- | --- |
| Description | Edit work items in this node on the item's area. |
| Comments | Check Edit work item comments in this node separately from general editing. |
| Child and predecessor links | Work item relationships are edits through the work item PATCH API. Check edit rights on affected items and visibility of targets. Creating an area child node is a different permission and does not authorize creating child Tasks. |
| Existing tags | Work item edit access permits assigning existing tags. |
| New tag definitions | Create tag definition is an additional permission; access-level constraints also apply. |

Sources for the table: [area and comment permissions](https://learn.microsoft.com/en-us/azure/devops/organizations/security/permissions-access?view=azure-devops), [tag permissions](https://learn.microsoft.com/en-us/azure/devops/organizations/security/set-permissions-access-work-tracking?view=azure-devops), [permission reference and access-level qualifications](https://learn.microsoft.com/en-us/azure/devops/organizations/security/permissions?view=azure-devops), [PATCH fields and relations](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1).

The update API lists `vso.work_write` scope. Scope authorizes an API category, not an override of area access, process rules or access level. Public project visibility is therefore insufficient evidence of write access. [Update API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1), [permissions and access](https://learn.microsoft.com/en-us/azure/devops/organizations/security/permissions-access?view=azure-devops).

## Preflight and refused writes

For GitHub, use repository role information as a coarse check and inspect issue-specific GraphQL capabilities where available. Do not infer that body editing also permits labels or relationships. The GraphQL schema is the authority for available viewer fields; field coverage for every relationship mutation remains unverified in this research. [GraphQL reference](https://docs.github.com/en/graphql/reference), [repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization).

GitHub distinguishes resource-inaccessible errors from validation failures. Missing private-resource access may appear as 404. A 403 can also mean rate limiting, and 422 can mean validation or spam protection. Inspect the response body and headers, including accepted token permissions, rather than classifying by HTTP status alone. [REST troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api).

Azure's Has Permissions API evaluates the caller against security namespace permission bits and resource tokens. Check the correct area's read, edit and comment permissions, plus tag creation when necessary. Work item PATCH supports `validateOnly=true`, which validates without saving, but does not reserve permission for a later write. [Has Permissions](https://learn.microsoft.com/en-us/rest/api/azure/devops/security/permissions/has-permissions?view=azure-devops-rest-7.1), [PATCH validation](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1).

Azure documents 401 for failed or missing authentication, 403 for missing operation permission, 404 for missing resources or missing view permission, 400 for invalid requests, and 409 for conflicts. Preserve the server's diagnostic response rather than promising a single refusal message. [REST response codes](https://learn.microsoft.com/en-us/azure/devops/integrate/how-to/call-rest-api?view=azure-devops).

## Consequences and remaining unknowns

The design should retain a local result until the intended provider operation succeeds and its relevant fields read back correctly. Preflight is advisory because rights or content can change between checks and writes. This is a research recommendation, not an implemented policy or a new product decision.

The following need targeted verification before implementation:

- Exact GitHub GraphQL viewer-field coverage for comments, labels and both relationship types, including cross-repository targets.
- Exact permission checks on both endpoints of cross-repository GitHub relationships and cross-area or cross-project Azure links. Conservatively check both; the sources above do not establish a complete operation-by-operation matrix.
- Azure comment creation versus editing another person's comment, and exact refusal payloads under each area denial. Do not assume the comment-edit permission's name settles all comment operations.
- Azure tag behavior for each access level and public versus private projects. Consult the applicable service version and access-level rules rather than assuming Contributor membership is sufficient.
- CLI preservation of provider error bodies and GraphQL partial errors. No refusal fixtures were captured in this documentation-only research.

No Domain docs draft is settled here. The remaining questions are verification constraints for the shared-format and publishing design, not evidence that non-maintainers can publish a complete concept.
