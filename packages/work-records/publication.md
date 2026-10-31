# Publication engine

The board server and installed command use `@lar-factory/work-records/publication`.
Browser code uses only `@lar-factory/shared/publication`. The existing work-record
journal owns all durable state; publication never changes Status or starts a build.

`publicationEngine(records, { dir?, settings?, provider? })` returns async methods:

- `prepare(workId, request)` records an immutable, unapproved plan.
- `inspect(workId, planId)` checks sources and fresh effective settings.
- `execute(workId, planId, identity)` and `resume(...)` dispatch outstanding writes.
- `fallback(workId, planId, delivery?)` previews comments after body or native-link refusal, or a handover after comment refusal.
- `reconcile(workId, planId, identity, selections?)` inspects uncertain outcomes.

`PreparePublication` contains `documents`, optional `typeSelections` indexed by work
ID, optional `replaces`, `delivery` and `resolutions`. Each document names `workId`,
`title`, `outcome`,
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
published text uses a new existing-ticket update operation.

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
body and link PATCH use `az rest`, following
[ADR 0029](../../docs/adr/0029-azure-calls-go-through-az-devops-invoke-and-only-a-work-item-patch-through-az-rest.md).
That PATCH still depends on az login's default tenant; another-tenant organizations
may refuse links despite successful reads and creation. Preview versions use bare
`-preview` because invoke appends the server resource version. WIQL refusal or result
limits leave uncertainty. Cross-provider and cross-organization native links need
textual fallback.

## Existing tickets and updates

A picked ticket or a known publication receipt selects an existing destination.
`prepare` appends a marked refined description below the original raw body.
Markdown uses neutral `refined-description` delimiters. HTML uses visible opening
and closing labels with escaped refinement text. Neither contains a factory ID.
The normal description editor is never involved.

The journal records the exact published text and body offsets or comment ID.
Azure body locations also record `field`, either `System.Description` or
`Microsoft.VSTS.TCM.ReproSteps`. Initial field selection follows the board's Bug
and Repro Steps behavior. Later updates keep the recorded field even if a teammate
adds another description field. HTML colours, merged cells and existing raw content
remain unchanged in the outgoing patch. The patch changes only that field, with a
`/rev` test. It never switches an existing field to Markdown.

`PreparePublication.delivery` maps work IDs to `body`, `comment` or `handover`.
The default `body` updates the last primary publication location, including a prior
comment fallback. `comment` deliberately plans a new Markdown comment on an existing
ticket. `handover` creates no operations for that record and needs no provider
content read or write consent. Settings and readiness still apply. The handover is
available through `publication-handover`, even with write access refused.
`attach-publication-url` attaches its eventual ordinary ticket to the same record
without replacing its brief, Status or identity. A manually posted comment URL
on the same ticket page may include its query or fragment.

Every update operation previews `expectedText` and `content` as the before and
after diff. Body operations also include the complete raw `expected` snapshot with
format, field, revision when available, assignment and linked-PR facts. The engine
locates only unique exact stored text. Edited, missing or ambiguous boundaries
throw `PublicationConflict` with `.conflict` containing `workId`, `stored`, `current`,
`proposed`, `location` and `reason`. No plan is recorded on that conflict.
`inspect` reports a later provider conflict in `PublicationPending.conflicts` and
makes the plan noncurrent.

After asking the user to resolve it, pass
`resolutions[workId] = { observedText, location, expectedText }` to `prepare` with
`replaces`. `observedText` is the complete raw description or comment the user saw.
`location` is their explicit replacement range or the same comment ID.
`expectedText` is the exact selected text. An empty body range explicitly appends
after removed content. The provider is reread and must still match the resolution.
The resulting plan requires approval of its new digest. A missing comment needs
an explicit new-comment or handover choice.

Assigned tickets and tickets with a linked PR get an additional short update
comment for a body write. Its exact text and dependency are in the same approval.
Unassigned tickets without a linked PR get no notice. Notices retain their own
operation outcomes but never replace the primary published text in `lastPublished`.
`PublishedText.operationKind` distinguishes primary text from relationship comments,
including when the owning plan belongs to a concept. Updates do not repeat
relationships already recorded as successful in earlier plans.

`edit-ticket` and `comment-ticket` keep separate consent and access checks.
`fallback` defaults body edits to a comment and comments to a handover. Its optional
third argument chooses `comment` or `handover` for outstanding text operations.
The CLI accepts that choice as `--file F` containing `{ "delivery": "handover" }`
or `{ "delivery": "comment" }`. It produces a new unapproved immutable plan and
retains successful operations. An earlier body approval never approves a fallback
comment. Unsupported format refusal includes exact Markdown comment and handover
alternatives. The CLI writes structured `publication-conflict` or
`publication-refused` JSON to stderr and exits 1 when preparation needs a choice.

The adapters reread immediately before writes and verify stored text after accepted
writes. A lost response, failed verification read or normalized raw text remains
uncertain. Reconciliation confirms body writes only when the complete raw body,
format and approved location match. Comments require exact content and explicit
candidate selection, and replacements also require the original comment ID.
Empty or conflicting evidence permits no automatic retry. Resolve the old outcome,
then prepare and approve a replacement before retrying.

### Concurrency limits

[Azure work-item updates](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1)
provide the revision test used for raw body edits. The same default-tenant limitation
as native-link PATCH applies. GitHub's
[issue update](https://docs.github.com/en/rest/issues/issues#update-an-issue) and
[comment update](https://docs.github.com/en/rest/issues/comments#update-an-issue-comment),
and [Azure comment update](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/update-comment?view=azure-devops-rest-7.1),
document no atomic revision precondition for these edits. Their reread and PATCH
can race a teammate edit. Post-write verification detects a differing stored result
but cannot recover overwritten text or guarantee an atomic update. Choose a new
comment or handover when that limit is unacceptable. A failed timeline or comment
read cannot establish that a PR or publication is absent.

Controlled-client tests cover both providers, including picked append, exact
replacement, HTML and Repro Steps preservation, conflicts, notices, refusals,
handovers, URL attachment and restart after lost body and comment responses.
No live tracker writes were used. PR closing references remain for the delivery
extension. Connections and external Dependencies remain outside this build.
