# Server behavioral tests group 2

Slice `5b6e59ed-b95b-483d-a59d-d0fee535d99c` reviewed all 20 assigned test files against their corresponding production modules. Retain all tests and assertions. No demonstrated duplicate or behavior-free test justified removal. No production code, tests, helpers or Copies changed. Existing fixes remain intact.

## File decisions

Paths below are relative to `apps/server/src`. Each row compares the test with the production module of the same name.

| Test file | Decision and surviving coverage |
| --- | --- |
| `item-details/item-details.test.ts` | Retain provider routing, Azure revision requirements, sample refusals, label preservation and filtering, kind plans, record bodies, export equivalence and durable Spec retries. Export parity tests the adapter contract; the separate empty and repeated exports test refusals. |
| `items/capture.test.ts` | Retain ticketless capture, request replay and collisions, search, picking and restoring, attachment ownership, uncertain provider creates across restart, stripped Azure markers, Access refusals and failed local persistence recovery. Each checks a separate point where duplicate tickets or lost context could occur. |
| `items/deleted-thread-notice.test.ts` | Retain persisted latest-thread deletion with live-work and newer-thread suppression. Reopening the database distinguishes durable confirmation from an in-memory notice. |
| `items/import-ticket.test.ts` | Retain Original extraction and absence of restored local briefs during structure recovery. Capture tests exercise a different caller, while this test directly checks the shared import boundary. |
| `items/item-commands.test.ts` | Retain Access guards, abandonment and restoration, concurrent observations, partial provider failures, close/reopen operations and build launch guards. Assertions on unchanged revisions, launch intents and provider calls verify refusal before side effects. |
| `items/item-sources.test.ts` | Retain active and idle pacing, invalidation routing, partial reads, fallback whole reads, change-check failures, quota limits, waiting sources and shared Azure board reads. Injected clock boundaries and read counts specify request volume without real polling delays. |
| `items/observe-records.test.ts` | Retain merged versus closed PRs, ticket closure/reopening/reassignment, confirmed absence versus temporary errors, hidden and excluded repositories, completion, six-read concurrency, Dependency observations and kind agreement. These distinguish durable state transitions from provider outages. |
| `items/pr-observer.test.ts` | Retain ETag/304 state preservation, fifteen-second polling, linked-read reuse, merged stop conditions, Access waits and retry pacing. These test scheduling and conditional transport separately from observation state transitions. |
| `items/record-items.test.ts` | Retain record precedence over tracker edits, label colours, ticketless and unread records, Archive visibility, structure and Dependency rendering, recovery without local completion, kind swaps and disagreement decisions. Projection assertions cover what the board actually receives. |
| `items/retention.test.ts` | Retain seven-day defaults, preview without saving, confirmed deletion and ownership protection, invalid settings and malformed persisted JSON. Preview and confirmation have different persistence contracts. |
| `items/work-cleanup.test.ts` | Retain ownership, protected branches, unknown remote state, changed-loss refusal, explicit loss confirmation, real disposable branch deletion, unsafe paths, inspected remote heads and sibling-worktree verification. Fake-command guards complement real Git effects. |
| `items/work-recovery.test.ts` | Retain present and missing branches, failed observations remaining unknown, and exact repository matching for GitHub and Azure. Prefix rejection protects against recovering another repository. |
| `onboarding/azure-access.test.ts` | Retain independent branch, PR and item permission evidence, all required tag-management permissions, missing evidence and unreadable permissions. Unknown permission evidence must not become positive Access. |
| `onboarding/azure-source-access.test.ts` | Retain selected-team bounded sampling, empty-team query access, unreadable or unbounded samples and invalid fields. Command assertions verify that discovery avoids descriptions, relations, PRs and broad fallback reads. |
| `onboarding/create-project.test.ts` | Retain successful addition, canonical path matching, missing and relative path rejection before T3, command failure and unreadable or absent resulting projects. These distinguish filesystem validation from remote registration outcomes. |
| `onboarding/detect-setup.test.ts` | Retain session restriction versus verified Access, path-only discovery, issues-disabled and unreadable repositories, Azure teams, checkout mismatch and duplicates, invalid input, triage versus write privileges and unverified tokens. |
| `onboarding/keep-onboarding.test.ts` | Retain replacement, invalid payloads, already-onboarded conflicts and removal of extra progress fields. Returned repository lists and persisted progress define the resume contract. |
| `onboarding/project-choices.test.ts` | Retain checkout-origin provider mapping and case-insensitive on-board detection with real temporary checkouts and project database. Absence of hasConfig guards the prohibition on repository configuration discovery. |
| `onboarding/project-skills.test.ts` | Retain supported agent directories and rejection of unsupported, nested, non-root and non-SKILL paths. Generated expected names describe independent input examples rather than invoking the parser to compute expectations. |
| `onboarding/project-teams.test.ts` | Retain decoded project arguments, returned team names, invalid repository refusal before execution and provider error reporting. Command shape is part of selecting the correct Azure project. |

## Removal inventory

None. All listed behavior survives in its existing tests. No new code was necessary. Temporary directories, subprocess boundaries and injected clocks remain unchanged.

## Evidence

Reused the full server baseline recorded in `/Users/pedrogomes/.t3/worktrees/lar-factory/t3-84586fd4/docs/reports/780-6bfae85a.md`: exit 0, 896 tests in 99 files, 101.13 seconds wall and 96.86 seconds runner duration under Node v24.22.1. This is prior baseline evidence, not a fresh run or a measured improvement. That report completed six reviews outside this group and marked this group pending; the decisions above complete this group only.

This report-only change requires no affected test run. `git diff --check` passed with `/opt/homebrew/opt/node@24/bin` prepended to PATH. No prose lint or format command is provided. Final package and root validation belongs to aggregate slice `2e84288b-6900-4374-9d61-22a0aac0f1aa`.
