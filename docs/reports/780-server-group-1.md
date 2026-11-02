# Server group 1 test review

Slice `6bfae85a-277b-4ad3-8913-df43d9061107` reviews the 20 files in its revised brief. Retain all assigned tests and assertions. Removal inventory: none. No source, test, helper, Copy or aggregate report changed. Existing fixes remain intact.

## Decisions and surviving coverage

### src/azure/azure-backlog.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-backlog.ts`. Team area ownership, requirement categories and backlog ordering have separate inputs. Batch and CLI assertions protect the provider route and hydration limits.

Surviving cases:

- `test("a backlog read lists the team's open requirement-level items under its area paths, in any sprint or none", async () => {`
- `test("Tasks count toward their parent, read through its child links, and Predecessors are blockers", async () => {`
- `test("an area path the team doesn't include with its children leaves out the items under it", async () => {`
- `test("the backlog's calls name the team and its requirement backlog, and every invoke passes --api-version", async () => {`
- `test('a logged-out az names its fix', async () => {`
- `test('backlog priority order survives hydration that returns work items in ID order', async () => {`
- `test('the team can put both PBIs and Bugs in its Requirement category', async () => {`

### src/azure/azure-board.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-board.ts`. Combined and partial reads must preserve sprint completion, priority, child counts and factory Task visibility. These differ from a backlog-only read.

Surviving cases:

- `test('the Azure board combines backlog and sprint once, keeping sprint completion and Task counts', async () => {`
- `test('the Azure board still reads the backlog when no sprint is current', async () => {`
- `test('the Azure board reports sprint read failures instead of silently dropping its items', async () => {`
- `test('combined reads keep backlog priority and count sprint children only for sprint parents', async () => {`
- `test('a concept exposes its Ready child build outside the sprint, while plain team Tasks stay hidden', async () => {`
- `test('factory tags expose Tasks, while kind, repository and slice tags alone keep team Tasks hidden', async () => {`
- `test('factory Tasks retain sprint completion, Removed filtering, blockers and repository placement', async () => {`
- `test('sprint membership names only current children and survives partial reads, without changing all-time backlog counts', async () => {`

### src/azure/azure-build-delivery.test.ts

Retain. Source boundary: `azure-repos.ts, config/pr-host.ts and items/observe-records.ts`. The local record remains in Review until an observed merge. Lost-response recovery checks branch lookup without creating a second PR. The create command itself exercises the fake CLI contract, not an automatic production PR creator.

Surviving cases:

- `test('an Azure build creates a PR against the actual base, records it locally, and finishes only after an observed merge', async (t) => {`
- `test('a lost PR-creation response is recovered by its source branch before recording or retrying', async () => {`

### src/azure/azure-details.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-details.ts`. Details preserve body formats, Bug fields, people, relations and attachments. Initial and older comment pages exercise separate entry points, including bounded managed-history lookahead and continuation.

Surviving cases:

- `test('a markdown description answers with its people, dates, iteration and area', async () => {`
- `test('an HTML description is answered as HTML', async () => {`
- `test('a description whose format is missing is HTML when it opens with a tag, else markdown', async () => {`
- `test('the work item is one batch read at 7.2-preview and its comments are read at 7.1-preview, 10 newest first', async () => {`
- `test('comments of mixed formats answer newest first, each in its own format', async () => {`
- `test('more than 10 comments answer the newest 10 and the token of the older ones', async () => {`
- `test('a work item with no description, people or comments answers empty details', async () => {`
- `test('the child work items answer as sub-tickets, Completed ones closed and Removed ones left out, from one batch read', async () => {`
- `test('a work item with no child links reads no batch', async () => {`
- `test('an az failure answers its message', async () => {`
- `test('a logged-out az answers the fix', async () => {`
- `test('a work item az no longer finds answers 404', async () => {`
- `test('an item without an Azure DevOps repository answers 404', async () => {`
- `test('older comments are one comments call with the continuation token, 10 newest first, and the next token', async () => {`
- `test('the oldest page answers no token', async () => {`
- `test('details and older pages skip managed-only history to its end without exposing transport comments', async () => {`
- `test('managed-only leading pages reveal all ordinary discussion from the larger lookahead page', async () => {`
- `test('large managed histories stop after three comments calls and preserve a continuation token', async () => {`
- `test('ordinary history keeps ten-comment pages in order without gaps or duplicate comments', async () => {`
- `test('older comments of a repository not on Azure DevOps, or of a failed az, answer the error', async () => {`
- `test('details hydrate 217 children in batches of at most 200', async () => {`
- `test('a child relations failure preserves the main description, people and comments and names the failed section', async () => {`
- `test('an empty Bug description falls back to Repro Steps, keeping Acceptance Criteria and System Info', async () => {`
- `test('an empty description is read from System.Description, except on a Bug, whose description is its Repro Steps', async () => {`
- `test('details keep named Azure attachments, Related work and predecessors alongside children', async () => {`
- `test('attachments survive a failed relation read and only link to Azure over HTTPS', async () => {`
- `test('a Bug displays Repro Steps even when Description also contains text', async () => {`

### src/azure/azure-items.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-items.ts`. Repository placement, cached process settings, failed-read invalidation, missing children and bounded PR concurrency protect independent branches of azureItems.

Surviving cases:

- `test("with web and api reading one sprint, an untagged item is for both, and a repo- tag places it in its repository's List only", async () => {`
- `test('a repo- tag matches its repository whatever its case', async () => {`
- `test("an item tagged for a repository that isn't onboarded, or with two repo- tags, is hidden with its Tasks", async () => {`
- `test("Tasks contribute to parent counts without becoming board items", async () => {`
- `test('one repository reading the sprint still leaves an untagged item untagged, for Start to tag', async () => {`
- `test("a ticket search lists the open backlog items for the repository whose title has every word, and a number reads that item alone", async () => {`
- `test("a ticket read gives an open work item's description and kind, and nothing for a closed one or another repository's", async () => {`
- `test('a ticket observation reads a work item open or not, with its assignee, and a confirmed not-found', async () => {`
- `test("a source reads the team's backlog levels and each type's states once per SETTINGS_TTL for its reads and writes, and again after a failed read", async () => {`
- `test('a read runs at most ${PR_READS} az repos pr show calls at once', async () => {`
- `test("an item whose type has no Removed state, such as Basic's Issue, carries why Abandon can't run; one whose type has one carries nothing", async () => {`
- `test('an item read alone keeps sprint child counts without relisting the sprint', async () => {`
- `test('native Azure type, state and assignee survive independently of factory status', async () => {`
- `test('sprint counts stay scoped when a listing also contains children from the backlog', async () => {`

### src/azure/azure-kind-swap.test.ts

Retain. Source boundary: `packages/shared/src/tracker-labels.ts and packages/work-records/src/change-kind.ts`. Type changes preserve visible text and tracker structure, test revisions and recover partial tag/type failures. Both directions and retry outcomes differ. The stale fixture assertion alone is weak, but its test also requires a rejection and unchanged original type.

Surviving cases:

- `test('a User Story becoming a Bug shows its description in Repro Steps, and the description stays', async () => {`
- `test('a Bug becoming a User Story shows its Repro Steps in the description, and Repro Steps stays', async () => {`
- `test('the details read shows the moved text as the main body, with the old field kept as a section', async () => {`
- `test('a change between other types moves no text', async () => {`
- `test('text already in the new field stays, after the moved text', async () => {`
- `test('going back to a type whose field already holds the text writes no second copy', async () => {`
- `test('markdown text moves as markdown, including into a field that was markdown already', async () => {`
- `test('structure stays in the description, in one copy, whichever way the type changes', async () => {`
- `test('someone changing the work item since the read fails the type change whole', async () => {`
- `test('read-only sessions refuse the type change before any az call', async () => {`
- `test('a kind change swaps tags and type on the fake, moves the text and keeps other tags', async () => {`
- `test('a type the team\'s backlog doesn\'t show stays, with its text where it was, and the tags still swap', async () => {`
- `test('a failed type change on the fake keeps the old kind, and running it again finishes', async () => {`

### src/azure/azure-labels.test.ts

Retain. Source boundary: `packages/shared/src/tracker-labels.ts`. Project rename/delete and ticket tag mutations have different effects. Case-insensitive no-op, revision conflict and route-character cases protect adapter behavior. The unsupported-create test validates the fake contract used by these integrations.

Surviving cases:

- `test('Azure lists the project tags', async () => {`
- `test('renaming a tag changes it in the project and on every work item', async () => {`
- `test('deleting a tag removes it from the project and from every work item', async () => {`
- `test("a tag name holding route characters reaches its own tag, on rename and on delete", async () => {`
- `test('adding a tag keeps every other tag on the work item, however many it has, and tests its revision', async () => {`
- `test('adding a tag to a work item with none sets just that tag', async () => {`
- `test('removing a tag keeps every other tag, ignores its case and clears the field when none remain', async () => {`
- `test('a change with nothing to do writes nothing', async () => {`
- `test('a work item changed since the read is refused and keeps its tags', async () => {`
- `test('the fake refuses a tag create, as Azure documents none', async () => {`

### src/azure/azure-readiness.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-readiness.ts`. Required policy, reviewer and status blockers differ from optional failures. Malformed evidence, pagination and revision races must fail closed, while empty successful lists remain available.

Surviving cases:

- `test('binds successful evidence to a revision', async () => expect(await read()).toMatchObject({ available: true, sourceRevision: 'old', blockers: [] }));`
- `test.each(['queued', 'running', 'rejected', 'broken', 'unknown'])('blocks required policy %s', async (state) => expect(await read(state)).toMatchObject({ available: true, blockers: ['policy:p:${state}'] }));`
- `test.each([-10, -5, 0, 99])('blocks unmet vote %s', async (vote) => expect(await read('approved', vote)).toMatchObject({ blockers: ['reviewer:r:${vote}'] }));`
- `test('blocks pending statuses and retains iteration', async () => expect(await read('approved', 10, 'pending')).toMatchObject({ blockers: ['status:/ci:pending'], statuses: [{ iterationId: 2 }] }));`
- `test('an unset native status blocks readiness while preserving the other evidence', async () => {`
- `test('invalidates revision races', async () => expect(await read('approved', 10, 'succeeded', true)).toMatchObject({ available: false }));`
- `test.each(['{}', 'null', 'not json'])('refuses malformed evidence %s', async (value) => expect(await readAzureReadiness('o', 'p', 'r', 1, async () => value)).toMatchObject({ available: false }));`
- `test('preserves permission failures', async () => expect(await readAzureReadiness('o', 'p', 'r', 1, async () => { throw new Error('403 forbidden'); })).toMatchObject({ available: false }));`
- `test('accepts empty successful lists', async () => {`
- `test('retains optional failures without treating them as required', async () => {`

### src/azure/azure-repos.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-repos.ts`. Exact branch matching and expected-head checks prevent deletion of a different ref. Provider rejection and read-only refusal exercise distinct failures.

Surviving cases:

- `test('deletes the exact slash branch with its observed object ID', async () => {`
- `test('rejects stale ref updates and provider failures', async () => {`
- `test('read-only refuses deletion before calling the runner', async () => {`
- `test('a changed head is refused before Azure deletion and unchanged deletion uses its object ID', async () => {`

### src/azure/azure-safety.test.ts

Retain. Source boundary: `azure-items.ts and packages/shared/src/azure-safety.ts`. The az entry point must reject writes before tool lookup or spawning. This wiring check complements the shared command classifier.

Surviving cases:

- `test('the board refuses Azure writes before looking up or spawning az', async () => {`

### src/azure/azure-sprint.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-sprint.ts`. Sprint membership, process categories, batch limits, PR mapping and provider errors differ from backlog ownership. Literal results and recorded provider calls check the external contract.

Surviving cases:

- `test("a sprint read lists requirement-level items with Task counts, a Completed item as Done, and no Removed item", async () => {`
- `test('a sprint counts only its own Tasks and keeps plain Tasks off the board, including on a partial refresh', async () => {`
- `test("every az call names the team's organization and project, and every invoke passes --api-version", async () => {`
- `test("each process's requirement type shows at the top level, and only the team's requirement backlog level's types do", async () => {`
- `test('a read of more than 200 ids reads their fields in batches of at most 200', async () => {`
- `test('status tags give the statuses and every other tag is a label', async () => {`
- `test("a logged-out az and a missing azure-devops extension each name their fix, and another repository's items still show", async () => {`
- `test('any other az failure fails the read, naming the repository', async () => {`
- `test("a work item's linked PRs show their state from az repos pr show, a draft as open, with no checks; a deleted PR is left out", async () => {`
- `test('a sprint follows backlog priority, with a completed sprint-only requirement after the backlog', async () => {`

### src/azure/azure-writes.test.ts

Retain. Source boundary: `apps/server/src/azure/azure-writes.ts`. Abandon and description saves use different versions and fields. Revision conflicts, missing Removed states, permission errors and non-Azure refusals protect separate outcomes.

Surviving cases:

- `test('Abandon moves the work item to its Removed-category state, and names a type with none', async () => {`
- `test('Abandon reads the work item with one batch read and PATCHes it through az rest at 7.1, testing its rev', async () => {`
- `test('a logged-out az shows its fix, and any other az error shows as it is', async () => {`
- `test('a saved description replaces the field the details read, as markdown, at 7.2-preview.3 and testing the rev read', async () => {`
- `test('a Bug whose description came from Repro Steps saves to Repro Steps', async () => {`
- `test('a work item changed since its details were read is a conflict, and writes nothing', async () => {`
- `test('no right to edit the work item, a logged-out az and any other az error each answer their message', async () => {`
- `test('an item that is not an Azure DevOps work item is refused', async () => {`

### src/config/repository-config.test.ts

Retain. Source boundary: `apps/server/src/config/repository-config.ts`. The shared repository-settings export validates local persistence, legacy entries, onboarding transitions and malformed input. Real temporary files test read-after-write behavior rather than fixture assignment.

Surviving cases:

- `test('the list file names the onboarded repositories, each still onboarding with its progress; a missing one names none', async (t) => {`
- `test('progress saved with the old show setting still resumes', async (t) => {`
- `test("an onboarding's setup answers may name an Azure DevOps team's sprint or backlog", async (t) => {`
- `test("an onboarding that isn't progress is refused, naming its entry", async (t) => {`
- `test('saving an onboarding adds its repository to the list, or updates its entry, and keeps the other entries as they are', async (t) => {`
- `test('saving an onboarding that picked another project replaces the entry it was saved under', async (t) => {`
- `test("the list starts empty in its own file, leaving the old repositories.json and settings.json as they are", async (t) => {`
- `test('saving an onboarding makes the list file and its folder when there are none', async (t) => {`
- `test('the repositories still onboarding are those with progress', () => {`
- `test('finishing an onboarding leaves its entry with the repository alone, in place of the entry it was saved under', async (t) => {`
- `test('saving an onboarding for a repository that is onboarded already, or into a list that can\'t be read, is refused', async (t) => {`
- `test("a list file that isn't JSON or has the wrong shape is refused, naming its path and the problem", async (t) => {`
- `test('a repository is owner/name on GitHub or organization/project/repository on Azure DevOps, as its origin URL has them', async (t) => {`
- `test("the repository list file sets the refresh interval, and the old settings.json doesn't; a missing file or field takes 300 seconds", async (t) => {`
- `test("a list file that isn't JSON, or whose refresh interval isn't a positive number, takes the default, naming its path and the problem", async (t) => {`
- `test('only issues and a combined Azure board are item sources', () => {`
- `test('removed-source onboarding entries do not break healthy repositories or later saves', async (t) => {`

### src/config/repository-labels.test.ts

Retain. Source boundary: `apps/server/src/config/repository-labels.ts`. The adapter boundary validates managed names, capabilities and access before mutation. Mapping updates after provider success are distinct from label CRUD.

Surviving cases:

- `test('a fake third tracker lists, creates, renames and deletes through its adapter alone', async (t) => {`
- `test('managed names are refused with the reason, whether typed or already on the tracker', async (t) => {`
- `test("Azure's repo- tags are locked, and GitHub's repo- labels are ordinary", async (t) => {`
- `test('changes that the capability rules out are refused before the adapter runs', async (t) => {`
- `test('a repository not on this Mac and a bad request are refused', async (t) => {`
- `test("a failed read reports the tracker's reason", async (t) => {`
- `test('on Azure a comma is refused, and rename and delete reach the fake az', async (t) => {`
- `test('LAR_FACTORY_AZURE_READ_ONLY=1 refuses Azure label writes and still reads', async (t) => {`
- `test('renaming a mapped label updates every kind mapping it, matching without case, and sends back the changed setup', async (t) => {`
- `test('a colour change and a label no kind maps leave mappings alone', async (t) => {`
- `test('deleting a mapped label removes it from the mapping and keeps the rest', async (t) => {`
- `test('a refused tracker change leaves mappings as they were', async (t) => {`
- `test('on GitHub a change stays in its repository, even under the same owner', async (t) => {`
- `test('renaming an Azure tag updates mappings in the project\'s other repositories, and no other project', async (t) => {`
- `test('deleting an Azure tag removes it from the project\'s mappings, and from no other project\'s', async (t) => {`
- `test('an Azure tag change leaves a GitHub repository named like the project alone', async (t) => {`
- `test('a list that cannot be saved says the tracker already changed', async (t) => {`

### src/config/repository-settings.test.ts

Retain. Source boundary: `apps/server/src/config/repository-settings.ts`. Local overrides, independent preferences, session read-only state and vocabulary access/success rules protect separate persistence decisions.

Surviving cases:

- `test('board reads only local overrides and makes no provider calls', async (t) => {`
- `test('local settings validate values and reset to factory defaults', async (t) => {`
- `test('Settings persists issue preferences independently and rejects invalid values', async (t) => {`
- `test('Azure read-only is exposed for this session without changing saved choices or GitHub', async (t) => {`
- `test('legacy private domain docs read as off and save as on or off', async (t) => {`
- `test('changing docs applies directly and leaves no acceptance gate', async (t) => {`
- `test('sharing cannot be enabled with unchecked access', async (t) => {`
- `test('vocabulary rejects malformed mappings before provider reads', async (t) => {`
- `test('vocabulary discovery reads existing terms and saving requires field access', async (t) => {`
- `test('Settings refuses a typed managed name with the reason, even when the tracker has that label', async (t) => {`
- `test('Settings persists created labels only after provider success', async (t) => {`

### src/github/delete-remote-branch.test.ts

Retain. Source boundary: `github.ts and config/pr-host.ts`. GitHub deletion encodes the exact ref, verifies its expected head and propagates provider failures. The facade identity assertion checks adapter wiring alongside the provider command.

Surviving cases:

- `test('the facade deletes the encoded exact branch ref', async () => {`
- `test('deletion failures propagate', async () => {`
- `test('checks the expected remote head using the provider login before deletion', async () => {`
- `test('a changed remote head prevents GitHub deletion', async () => {`

### src/github/github-details.test.ts

Retain. Source boundary: `apps/server/src/github/github-details.ts`. GraphQL initial/older pages and body-file writes have different contracts. Managed history limits, missing items, permission failures and temporary-file cleanup remain observable behavior.

Surviving cases:

- `test('an issue answers its body, people, milestone, sub-tickets and comments, newest first', async () => {`
- `test('an item with no body, author or comments answers empty details', async () => {`
- `test('opening an item makes one GraphQL call, by node id, for the last 10 comments and no other page', async () => {`
- `test('an item GitHub does not know says so, and a failed gh call answers its message', async () => {`
- `test('older comments are one graphql call for the 10 before the cursor, newest first, with the next cursor', async () => {`
- `test('older comments of an item GitHub no longer has or of a failed call answer the error', async () => {`
- `test('details and older pages skip managed-only history to its end without exposing transport comments', async () => {`
- `test('managed-only leading pages reveal all ordinary discussion from the larger lookahead page', async () => {`
- `test('large managed histories stop after three calls and preserve a cursor for continued discussion reads', async () => {`
- `test('ordinary history keeps ten-comment pages in order without gaps or duplicate comments', async () => {`
- `test('a saved description is the issue body, through gh issue edit --body-file', async () => {`
- `test('a failed edit answers its message, and no right to edit the issue is 403', async () => {`

### src/github/github.test.ts

Retain. Source boundary: `apps/server/src/github/github.ts`. Query assertions protect required fields and intentionally omitted bodies, which control request size. Conditional ETag reads and token scope evidence exercise runtime behavior. Query syntax checks are contract checks rather than computed expected values.

Surviving cases:

- `test('the board query reads the blocked-by issues, and no issue or linked PR bodies', () => {`
- `test("the board query reads up to 100 labels of an issue, each with its colour", () => {`
- `test("the PR bodies query reads only each linked PR's id, body and merge time", () => {`
- `test("the board query reads each slice's state reason", () => {`
- `test('an issue search page reads only each issue\'s number and repo', () => {`
- `test("the dossier bodies query reads only each issue's id and body", () => {`
- `test('a change check asks again with the last ETag, and an unchanged answer, a 304, is null', async () => {`
- `test('repository role alone never proves token write access', async () => {`
- `test('classic repo scope proves token writes while public_repo covers only public repositories', async () => {`

### src/github/pr-stats.test.ts

Retain. Source boundary: `apps/server/src/github/pr-stats.ts`. Literal display values complement round trips. Exact data, legacy parsing, monotonic totals, marker boundaries and edit eligibility have different failure modes; round trips alone would not replace the literal cases.

Surviving cases:

- `test('the block shows agent time, wall time, total tokens and API cost, between markers', () => {`
- `test('the block displays whole dollars and preserves cents in its data', () => {`
- `test('PR times use minute precision and keep every positive short duration visible', () => {`
- `test('a body without a block gets one appended; the text before it is kept byte for byte', () => {`
- `test('a body with a block gets only the block replaced', () => {`
- `test('a merged build refreshes an outdated block before freezing and retains its exact final figures', () => {`
- `test('a running PR keeps exact figures so its rounded display cannot inflate the merged build', () => {`
- `test('a stale stats read never lowers known final figures, including when the PR body changed after the board read it', () => {`
- `test('markers count only alone on their own line, so a marker quoted in prose is left as it is', () => {`
- `test('edits refresh open and merged PRs whose block is missing or out of date, leaving closed ones alone', () => {`
- `test('an edit\'s block applies again to a newer body, and a body already current needs none', () => {`
- `test('PRs in a repo with no items on the board are left alone; any repo with items gets its blocks', () => {`
- `test('only builds write a PR\'s block: a parent that isn\'t a build, linked to the same PR, writes nothing', () => {`
- `test('only builds freeze figures from a merged PR; an issue that isn\'t a build keeps live figures', () => {`
- `test('missing or unavailable stats, or an unread body, make no edit; a PR linked twice is edited once', () => {`
- `test('a merged PR gets final stats, then needs no further edit', () => {`
- `test('a merged item takes the figures its merged PR\'s block holds, frozen, as the block wrote them', () => {`
- `test('a merged item reads a block in the old format, from before wall time, with no wall time', () => {`
- `test('a merged item falls back to live stats when no merged PR has a readable block', () => {`
- `test('a merged item reads its most recently merged PR\'s block, and an open linked PR keeps it live', () => {`

### src/github/repo-issues.test.ts

Retain. Source boundary: `apps/server/src/github/repo-issues.ts`. Search, read, observation, conditional change detection and abandon are separate public operations. Missing tickets differ from provider errors, and old closed comments differ from recent closure.

Surviving cases:

- `test("a ticket search lists the repository's open issues matching the words, and a number reads that issue alone", async () => {`
- `test("a ticket read gives an open issue's text and kind, and nothing for a closed or missing one", async () => {`
- `test('a ticket observation reads its state and assignees, and a confirmed not-found, but throws on any other failure', async () => {`
- `test("a change check lists the issues and PRs updated since, and can't tell once every one it lists changed", async () => {`
- `test('a change check leaves out an edit to an issue that closed before it, as a comment on an old one', async () => {`
- `test('Abandon closes an issue as not planned and reports close failures', async () => {`

## Recovered completed-six evidence

The following retention evidence is copied verbatim from `t3-84586fd4/docs/reports/780-6bfae85a.md`. These six files remain outside this group.

The following files received a source and assertion review.

- `src/board/board-state.test.ts` checks fresh-read expiry, cached-source exclusion, in-flight revision protection, removal notifications, multi-status confirmation and reopening after Abandon. These exercise separate guards in `applyRead`, `showChanged` and `remove`. Retain all six.
- `src/json-file.test.ts` uses real temporary files to distinguish an object, missing file, malformed JSON, array and null. Each input exercises the documented read boundary. Retain it.
- `src/stats/intervals.test.ts` checks independent literal examples for sorting, overlap, adjacency, empty and reversed intervals, intersecting cuts, cuts spanning separate intervals and total length. These exercise `merged`, `minus` and `length`. Retain all three.
- `src/stats/usage-pricing.test.ts` checks override precedence, missing cache-rate fallback, exact override names, zero costs, speed tiers, qualified-name ambiguity, excluded model families, alias cycles and aggregate null versus zero. Published-tier comparisons complement literal expected costs. The tests call the pricing functions rather than asserting fixture assignments. Retain all 13.
- `src/tools/cooldown.test.ts` checks known reset boundaries, fallback exponential backoff, reset after success and unrelated failures. Its injected times avoid real waits. Retain all three.
- `test/sample.test.ts` validates sample reference uniqueness and model choices served by a real board subprocess. The helper's negative examples establish that the uniqueness checker catches collisions rather than passing every fixture. Retain all three. Model-choice transport was inspected through the test and existing fixture contract, not a complete server startup source review.

No demonstrated duplicate or behavior-free case emerged in this subset. Retention here is a behavioral decision, not a performance claim. No new code or helper was necessary.

## Validation and baseline

Report-only change. `git diff --check` passed. No affected tests require a new run. No prose lint or format script exists in the root manifest. Final package and root checks belong to aggregate slice `2e84288b-6900-4374-9d61-22a0aac0f1aa`.

The earlier report records the following baseline conditions verbatim. This is reused evidence, not a fresh run or a controlled speed comparison.

Starting commit was `1c76e5b37f0c88940423af3281a54f5a09b481d8`. This worktree uses Node v24.22.1 and pnpm 12.14.0. Commands prepend `/opt/homebrew/opt/node@24/bin` to PATH.

The existing `780-a9f33a1c.md` report supplies the earlier server baseline at `1360f8404f39490b0dccf85c79f6609f322529d7`: 246.74 seconds wall, exit 1, 892 passed and four failed. That report also records a later 896-test pass. The restart implementation and machine load differ between that baseline and this worktree. No controlled comparison or improvement is claimed. Other web/shared agents were active per the task handoff.

The fresh command is `/usr/bin/time -p pnpm --dir apps/server test`, with local output in `/tmp/780-server-after.log`. It includes skill assembly and web build. The command completed with exit 0, all 896 tests in 99 files passing, 101.13 seconds wall and 96.86 seconds runner duration. No process was stopped for elapsed time. This slice changes documentation only. The repository supplies no prose lint or format command. `git diff --check` is the applicable whitespace check. Aggregate root validation belongs to the final validation owner.
