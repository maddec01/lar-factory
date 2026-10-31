# Publication engine

The board server and installed command use `@lar-factory/work-records/publication`.
Browser code uses only `@lar-factory/shared/publication`. The existing work-record
journal owns all durable state; publication never changes Status or starts a build.

`publicationEngine(records, { dir?, settings?, provider? })` returns async methods:

- `prepare(workId, request)` records an immutable, unapproved plan.
- `inspect(workId, planId)` checks sources and fresh effective settings.
- `execute(workId, planId, identity)` and `resume(...)` dispatch outstanding writes.
- `fallback(workId, planId)` previews exact comments after refused native links.
- `reconcile(workId, planId, identity, selections?)` inspects uncertain outcomes.

`PreparePublication` contains `documents`, optional `typeSelections` indexed by work
ID, and optional `replaces`. Each document names `workId`, `title`, `outcome`,
`change`, `checks`, `assumptions`, `decisions` with `decision` and `reason`,
`builderNotes`, `domainNotes` and `relatedTickets` containing URLs. Lists are required
and may be empty when nothing applies. The caller writes these team-language
projections from the refinement for review. The engine renders concept destination
and decision gists and complete build content; it never copies private maps or
rewrites arbitrary private prose. Decisions contribute evidence but never tickets.
Slices never publish.

Settings come from `readPublicationSettings(repo, options?)` in
`@lar-factory/shared/publication-settings`, returning `{ setup, discovery, snapshot }`.
Each ticket records its effective settings snapshot. Structural `build` and `issue`
records have no kind mapping; `resolveVocabulary` accepts `undefined` for that kind.
Conflicting exclusive types require a choice before preview; `null` chooses none.
Creation, later body edits, comments, types, terms and native relationships keep
separate consents. Initial body content belongs to creation consent; later body
changes require `edit-ticket`. Saved credential refusal blocks that operation.

Approve with the journal's
`approvePublication(workId, planId, revision, digest, identity)`, echoing the inspected
digest. Sources and settings are checked before every outstanding write. A
replacement may refresh settings evidence and retain completed creations, including
URLs already attached by the board. Their provider payloads stay exact; changing
published text requires the dependent existing-ticket flow.

Operations run parent creation, build creations, then native relationships.
`ticketWorkId` is the child or dependent; `relatedWorkId` is its parent or blocker.
References come from recorded receipts. Only local relationships within the plan
publish here; Connections and external Dependencies remain outside this build.

Claims become uncertain atomically before dispatch. Each provider result persists
before the next operation. Failure or uncertainty stops dispatch, retains successes
and reports each outcome separately. No method rolls back success or retries a
write automatically. Creation recovery searches by approved title, destination and
claim time, then inspects full content and terms. Comments are paginated and checked
against exact text. Candidates need explicit user selection with
`{ operationId, ticket }` or `{ operationId, commentId }`. A confirmed native link can
resolve directly. Empty or ambiguous evidence leaves uncertainty. A user can declare
that an uncertain write did not complete through `resolve-publication-outcome`,
with identity and inspected provider evidence. Every retry needs a replacement and
new approval.

The CLI exposes `prepare-publication`, `inspect-publication`, `approve-publication`,
`execute-publication`, `reconcile-publication`, `resume-publication` and
`fallback-publication`; `--help` describes JSON inputs. `--data-dir` selects the
journal and settings. `publication-handover` prints the same content for manual
posting. Preview and cancellation leave private work available.

## Provider limits

`@lar-factory/work-records/publication-providers` exports `PublicationProvider` and
`publicationProvider(transport?)`. Both the command and board use these adapters.
The default transport shares `@lar-factory/shared/provider-command` with Vocabulary
discovery and uses the local `gh` and `az` logins. It never retries a request or
writes credentials, factory markers, assignees, priority, iteration, State, board
changes or repository tags.

GitHub uses approved title, body, mapped labels and selected type. Relationships use
the [sub-issue](https://docs.github.com/en/rest/issues/sub-issues) and
[dependency](https://docs.github.com/en/rest/issues/issue-dependencies) endpoints.
Unavailable endpoints and permission refusals need approved textual fallback; 404
alone does not establish that a capability is absent.

Azure requires a mapped work item type, and tags cannot contain semicolons. New
bodies use [Markdown's multilineFieldsFormat setting](https://devblogs.microsoft.com/devops/markdown-support-arrives-for-work-items/).
Creation, reads and comments use `az devops invoke`. Only revision-checked work-item
link PATCH uses `az rest`, following
[ADR 0029](../../docs/adr/0029-azure-calls-go-through-az-devops-invoke-and-only-a-work-item-patch-through-az-rest.md).
That PATCH still depends on az login's default tenant; another-tenant organizations
may refuse links despite successful reads and creation. Preview versions use bare
`-preview` because invoke appends the server resource version. WIQL refusal or result
limits leave uncertainty. Cross-provider and cross-organization native links need
textual fallback.

The dependent provider slice extends these files for existing-ticket append,
guarded replacement, HTML preservation and PR closing writes. This entry dispatches
creation, native links and approved textual relationship comments. Controlled tests
cover both providers, including lost creation responses. No live tracker writes
were used for validation.
