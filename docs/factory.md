# What the factory does

This is the target behavior for [#891](https://github.com/maddec01/lar-factory/issues/891).
Pedro approves this description before the first simulation round. Each run is
checked against it. A PR that changes factory behavior updates this document.
This description includes Pedro's decisions on scheduling, scope changes,
approval and delivery evidence. A round records its scenario's answers before
running.

The factory shapes work without implementing it, then builds chosen briefs into
reviewed PRs. Pedro makes product decisions, approves briefs, verifies changes
that need a hand check and merges every PR. Agents find facts and make routine
implementation choices within that authorization.

## Records, commands and stage ownership

A Project is an onboarded repository. Settings live in the local app data folder,
normally `~/Library/Application Support/Lar Factory/`, selected instead by an
absolute `LAR_FACTORY_DATA_DIR`. `repository-settings.json` holds Project settings;
`work-records.db` holds work. Provider credentials stay in local logins. The
factory creates no repository configuration or agent guidance files. It follows
existing project instructions, conventions, package scripts, CI and nearby tests.

The following names already exist. `lar-work read ID` reads `workId`, `title`,
`repository`, `kind`, `status`, `queueOrder`, `ticket`, `parentId`, `buildPhase`,
`buildBranch`, `pullRequest`, `setAside`, `fogGone`, `needsYou`, `needsYouCauses`,
`skills`, `finishedAt` and `revision`. `context ID` reads the preserved starting
text. `body ID --body NAME` reads `brief`, `map`, `decision`, `answer` or
`domain-drafts`. `children`, `blockers`, `dependents`, `dependencies`, `threads`,
`observations`, `gate`, `review-rounds` and `checks` read related records.

Unless stated otherwise, a change names the last read `--revision N`. A stale
revision writes nothing; reread and reconsider the change. Validation records
and some Dependency operations have their own revision rules. Use
`set-body ID --revision N --body NAME --file F` for body writes. Use `update`
for Status and Kind, normally through `skills/shared/scripts/status.sh`, which
also asks the board to refresh. Status alone never proves completion.

Except for the implemented run settings commands described below, these
additional fields and commands are proposed contracts, not commands an agent can
run today. They give later implementation and simulation work a named input and
output. Their CLI spelling may change only with this document.

| Proposed command                                                 | Reads and writes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lar-work record-stage ID --revision N --file F`                 | Appends a `stageEvents` entry with stage, running/waiting/completed/failed state, input revisions and digests, output references, role runs, wait reason and timestamps. Stores question IDs, answers and the Status to resume. Records head-bound `verification`, release-step evidence and `outcomeCheck` results when those stages run. Does not duplicate bodies.                                                            |
| `lar-work snapshot-run ID --revision N --file F`                 | Saves immutable `runSettings` with thread kind, reviewer definitions and their digests, trigger version, resolved provider instance, model, effort and project skills. Each `roleRuns` entry records requested and actual settings, thread/task identity, result and failure.                                                                                                                                                    |
| `lar-work amend-group ID --revision N --file F`                  | Atomically applies an agent's reviewed change set with expected revisions for every affected record, including across concepts and standalone work. Supports creation in a named repository, retitling, attachment, `flow`, blocker changes, `supersededBy`, release steps, Outcome check criteria and setting work aside. Records a `changeSets` entry and invalidates affected gates. A stale member rejects the whole change. |
| `lar-work work-order ID`                                         | Returns a compact generated map and topological order with each record's Status, queued flag, gate, blockers, Dependencies and wait reasons. It reads records, never a hand-written graph.                                                                                                                                                                                                                                       |
| `lar-work build-overlap ID`                                      | Compares the brief's named files with other unfinished builds in the same repository, across concepts and standalone work. Returns matching files and record revisions for reconciliation. Agents also check shared contracts, including across repositories, and record blockers for conflicts.                                                                                                                                 |
| `lar-work prepare-build ID --revision N`                         | Checks eligibility and blockers, reserves a slot in the shared build capacity, saves `buildInput` and the launch intent. Returns a capacity reservation or all hold reasons. Does not launch T3. The board performs the launch and resolves its intent.                                                                                                                                                                          |
| `lar-work set-build-run ID --revision N --state running\|paused` | Checks group readiness and saves `buildRun`, the prepared member revisions and any pause reason. The board scheduler observes it and requests eligible starts.                                                                                                                                                                                                                                                                   |
| `lar-work select-reviewers ID --diff-base SHA --diff-head SHA`   | Reads the saved reviewer settings and exact diff; writes `reviewSelection` with matcher version, matching evidence and a run/skip reason for every reviewer.                                                                                                                                                                                                                                                                     |
| `lar-work record-gate-batch --file F`                            | Takes a displayed manifest of IDs, digests, Doubt results and Pedro's explicit approval. Rechecks every revision and digest before recording all gates. Any mismatch records none.                                                                                                                                                                                                                                               |

`create-parts GROUP --revision N --file F` is implemented for concept and linked
parents. F contains `{map,parts:[{key,title,repository,kind,body,blockerIds,
 ticketRequestId?}]}`. `$key` names a new blocker; `${key}` in text inserts its
work ID. One transaction saves every record, its Queued state, local map,
blockers and durable ticket requests supplied by Settings. Tracker calls follow
that commit; `sync-part-tickets GROUP` recovers the same requests after failure.
An external tracker cannot join SQLite's transaction; no partial local group is
published while parts are being inserted.

Briefs declare `Blocked by:` with backtick unique work titles or `none`; legacy
work IDs are also accepted. Local maps may declare `Blocker: `consumer ID`<-`prerequisite ID``. `sync-blockers GROUP --file F` derives the stored graph from
these declarations, with `{revisions:{ID:N}}` for the group, declared records
and all edge endpoints. It rejects stale revisions, retired prerequisites,
cycles and redundant edges together. Missing or conflicting declarations remain holds. Normalize older free prose to declarations;
never guess relationships or add delivery edges by hand. `reconcile` reports
declared/stored differences as mechanical holds. Brief `Contracts:` names shared
contracts, `Produces:` identifies their producer, and `Consumes:` names work titles
or IDs. Delivery-section citations and map Parts references also identify consumed
outputs. Shared labels without an identified producer remain unresolved contract-source
holds. `sync-blockers` derives consumer→producer prerequisites, retaining a transitive
path instead of redundant edges. A consuming brief may record
``No ordering needed: `reference`: reason`` (work title, ID or contract name).
Overlap alone never adds an approval dependency; an actually cited contract still does.
A part named by an unanswered decision stays a candidate with its holds; set-aside
refuses early retirement.

Current answer and map prose keeps source fingerprints. Changes to decisions,
briefs (including Notes), membership or blockers make that prose
require review independently of brief approval. `refresh-projections GROUP
--file F` saves `{revisions:{ID:N},answers:{ID:text},map?}` against every group
revision and captures all reviewed projections together. Answer versions and
`map-history GROUP` retain history. The command checks source freshness; the
owner still checks semantic agreement. Exact quotes in current answers are checked
against their referenced parts' current briefs, including Notes; a stale quote
holds reconciliation and rejects projection refresh atomically. Historical text stays. A map write settles incorporated decisions
immediately. Editing a delivery draft moves it to Shaping until its new gate;
it cannot be silently requeued after an approved draft changes. Map reads replace
legacy Parts prose with record-derived status, gate, Spec state and phase; agents
write narrative and destination only. Map history retains original prose. Work-order
labels absorbed builds Merged into the survivor and distinguishes ordinary Set aside.

Decision answers put chosen product content under `## Product`; `## History`
retains context outside approval and scheduling digests. Legacy answers remain
readable with workflow-status sentences excluded. Delivery progress is generated
from records, never written into answers or map narrative. Status-only answer
refreshes leave the product version unchanged. Doubt retains named product inputs
so stale gates identify a changed cited answer, contract or brief honestly.

Records hold product content. Launch/handoff environment and frozen model/role
contracts stay in thread prompts and run-settings records. All body writes,
including part creation and projection refresh, reject copied runtime blocks
before changing content, history or digests. Ordinary product discussion of
settings is allowed.

The same command layer serves the board and skills. It owns transitions,
completion, capacity reservations, graph validation, ordering and reviewer selection.
`record-stage` validates the transition and derives Status and the Needs you
notice from the stage and wait. Gate and completion commands supply facts for
those transitions. Agents report an outcome rather than choose its Status.
Existing `update` and `status.sh` remain compatibility interfaces to that logic.
Agents own scope, questions, evidence, useful build boundaries, semantic conflicts
and findings. Commands cannot decide whether two product promises agree.

Each stage has one instruction home. Pick-up and size-up live in
`skills/lar-shape/pick-up.md` and `size-up.md`; questions live in
`skills/shared/questions.md`; grilling, research, prototypes, concepts, brief and
gate live in the corresponding `skills/lar-shape` files. Start build lives in
`skills/lar-shape/start-build.md`. Build routing lives in
`skills/lar-build/agents/builder.md`; each delegated role lives in its own agent
file. Checks live in `skills/lar-build/project-rules.md`; handoff lives in
`skills/shared/handoff.md`. Group reconciliation will have one new home at
`skills/shared/reconcile-group.md`. A caller links to a shared stage rather than repeating
its rules. Build-time brief corrections use the same brief and gate stages.

Today: build phases, review rounds, run settings and confirmed scope have record
contracts; other shaping checkpoints still lack them and starts do not yet capture run settings. Some stage text is repeated across
skills. `lar-work` has no atomic group amendment, compact work order, build
reservation.

## What the board shows

Queue, Shaping, Ready to build and Build contain only single-flow issues.
Their stored Status values are `Queued`, `Shaping`, `Ready`, and `In progress`
or `Review`, followed by `Verify` or `Ready to merge`. A single-flow issue can
have private slices. Slices stay inside its build and never become independent
board tickets.

Concepts, linked-work parents and their parts stay in Concepts and linked work,
including while queued, shaping, building, waiting and finishing. A proposed
`flow` field distinguishes `single` from `linked` for non-concept parents;
private slices do not make a build a linked-work parent. Concept Kind implies
grouped work. Each group shows its current stage, refinement and delivery
separately, a generated Work map, buildable order and all wait reasons. Each part
shows whether it is queued. A completed part stays available in its group's
history.

Your desk lists everything waiting on Pedro, of any Kind and at any stage, including
held ticket edits requiring the board's Accept edit or Keep current action.
A pending group brief batch has one Approve briefs card naming the parent and its
members, rather than separate member approval cards. Current Doubt and missing or
invalid gates determine that batch, whether the approval notice is on the parent
or its members. It opens the existing exact
batch display and board approval buttons; unfinished Doubt remains an agent wait.
This includes concepts, linked-work parents, decisions, builds and slice questions.
The item also stays in its group or ordinary stage section. A card names the item,
its Project and its concept or parent when present. It says what is needed and
offers an action that works from the desk: Answer in T3, Approve brief,
Verify, Merge PR, Choose follow-ups, Recheck access or Start again. Answer opens the exact unresolved
question. Merge uses the same guarded merge action as item details.

Questions and tool approvals are answered in T3, through the exact owner thread
linked from the desk. Role threads are titled `Role · Work title` (including
Explore and Doubt); owner titles keep `Shaping #N …` or `Build #N …`. Tool
approvals have their own Approval in T3 wait, naming the owner and T3's display
prompt when available; resolving the request clears
that wait. The board never approves tools. Chat alone does not establish a wait.
When question tools are unavailable, the explicit saved question and Needs you
notice keep it actionable. Agent work, ordinary blockers, a full
build limit, CI in progress and an unmet prerequisite create wait reasons, not
desk cards, unless Pedro must act. A quiet thread gets an honest notice; five
minutes without a new action and with no tool running does not prove failure.
Unavailable activity remains unknown.

Actions say Start shaping, Start decision or Start build. Start after names the
prerequisite and the action it will start. Labels name the current stage, such as
Waiting for brief approval, Implementing, Code review or Waiting for required
checks. A build waiting for Pedro retains the progress stage from its build state. Tracker Labels and Kind are separate from workflow Status. Factory
progress never becomes tracker labels, tags, comments or Azure State.

A changed brief offers approval only after Doubt has a result for its current
package and displayed digest. Until then the item says Doubt reviewing without
a human approval action or desk wait. Board approval of an active amended build
queues a durable notification for its build owner, regardless of newer shaping
threads; restart retries reuse the same message identity. The retained tracker
Spec is labelled Out-of-date Spec whenever its approved gate is no longer current,
including while an already-open dialog receives another amendment.

Every view must show the same record revision and wait reasons, readable text
and reachable actions in light and dark appearance and small and large windows.
Loading, empty, error and unknown states must not claim readiness or completion.

Today: `packages/shared/src/board-view.ts` returns grouped work only in the group,
excluding it from the desk. A Queued concept can appear in Queue. The glossary's
Your desk definition excludes grouped work; it must change with that behavior.

## Settings and roles

At build start the system resolves a Node test runtime once: the project's saved
`project-runtimes.json` entry in local app data, otherwise the board environment's
Node executable and version used by checks. It freezes that value in run settings
alongside model and effort. Builder, implementer, slices, checks, CI fixer and
approver run every test with `lar-work run-test ID --role ROLE [--record] -- COMMAND`.
The owning run ID travels in `LAR_FACTORY_RUN_ID` (or `--run-id`), including after
handoff; focused red/green and recorded suites use its frozen executable directory
on PATH. Later Project setting changes affect only new runs. Agents never register,
ask about or change runtimes. Missing or mismatched frozen runtimes hold execution
with a reason before tests run, without asking Pedro. No repository files are
inspected for runtime selection. Non-test checks retain `run-check`.

Reviewer selection is saved before launching reviews. Item details show every
selected/skipped reviewer, its selection reason, live execution status and
terminal result or recorded verdict, updating as review progresses.

The [run settings contract](run-settings.md) freezes Settings before board launches,
validates model capabilities, and records requested versus reported execution.
Threads pass the snapshot to every delegated role and snapshot-linked review.
`role-launch` constructs and records each delegate request from that snapshot;
`role-finish` compares T3's reported execution and holds mismatches with Needs you.
The skill supplies the role's brief and passes the command's launch JSON unchanged.

Access follows T3 Code's own project or thread setting. The factory never
chooses an access policy or offers an access-mode control in Settings. New
owners use T3's project default; child roles inherit their parent's access,
without escalation. See [T3 access API behavior](t3-access.md) for the required
launch adapter and source references. Brief and batch gates, Verify, release
steps and merges remain board-only.

Settings has machine-wide defaults for reviewers, models and effort. It offers
model and effort per thread kind: shaping, concept, decision and
build. Gate and linked work use stages of those kinds, rather than requiring
another full workflow. Gate-only work uses shaping settings. Settings also offers
model and effort per role: Explore, Diagnose, Research, Prototype, planner,
implementer, checks, domain docs, each reviewer, fixer, approver, CI fixer and
Doubt. A role override wins; otherwise the role inherits its owning thread's
resolved choice. A Small build uses the build thread's choice for implementation.

The default thread choice is Project default in T3, including its effective effort
and options. A model explicitly selected for Start uses the project's options
only when it is that project's default model, as today. Saved per-kind choices
replace repeated manual picks. Auto-build keeps any existing explicit model
choice on migration; otherwise it uses the build kind's setting. Roles inherit
by default. No fixed vendor or model is silently substituted.

Each reviewer has a stable ID, a model/effort override and a mode of always, on
trigger or never. Packaged reviewers only allow mode changes; Duplicate copies their
instructions and trigger into a new custom reviewer that Pedro can edit, disable or
delete, or he can create a custom reviewer from scratch. Existing saved edits to
packaged reviewers migrate to custom copies, keeping their instruction history. Trigger
rules are saved, versioned predicates over changed paths and diff text. The
selection command evaluates them without a model and records the matched rule
and evidence. Custom reviewers start as always unless Pedro chooses another
mode and supplies a trigger. A new instruction revision affects future runs.

| Reviewer    | Default mode | Trigger intent, matching today's review policy                                                                            |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Code        | Always       | Every build.                                                                                                              |
| Security    | On trigger   | Input, auth, sessions, permissions, paths, uploads, shell scripts, dependencies, lockfiles, CI, secrets or network calls. |
| UI          | On trigger   | A change visible on screen.                                                                                               |
| Performance | On trigger   | Rendering, polling, queries or loops over large data.                                                                     |

The deterministic rule definitions must cover those cases, including changed
code symbols beyond obvious filenames. Tests fix the rules' interpretation.
Trial the initial rules against today's reviewer choices. Pedro approves any
unavoidable difference in selection.
An agent can request an additional review with a recorded reason; never mode
still wins. An uncertain trigger match runs the reviewer and records the rule
that made it uncertain. A skipped reviewer stays in the record with its reason.
Skipping a configured review alone does not mean an attempted review was unable
to check something.

Doubt and the approver remain required stages. Their model and effort can change;
the ordinary reviewer switches do not remove brief approval or PR assessment.
The saved Settings snapshot applies for the whole run, including handoff and
review retries. Later runs use later settings. T3 must confirm the requested
provider, model and effort. An unavailable choice waits with a Needs you notice
instead of falling back. The board exposes the run's actual role settings.

Settings and custom instructions stay in the local app data folder. Work records
keep the snapshot and execution evidence. Auto-build defaults OFF; build and
heavy command limits retain their current machine settings. Existing issue
creation, Spec writing, Access, domain docs and shaping thread cleanup defaults
also stay unchanged.

Today: Settings offers reviewer modes, custom reviewers, and per-kind/per-role
model and effort choices, while item details show saved choices from recorded
run snapshots. Connecting every launch and its actual settings report to these
records is still pending.

## Shaping stages

For every stage below, `record-stage` saves its entry, output and exit or wait.
The owner uses the thread kind's saved settings; named agents use their role
settings. The placement and desk rules above apply equally inside a group.

### Capture and pick-up

Add item creates local work or a tracker issue under the saved Project default.
`lar-work create --title X --repository R --kind K --file F` creates local work
in List. `import` reuses ticket identity. `create-ticket` with a durable
`--request-id` creates and attaches a ticket later; `attach-ticket` keeps the
work ID. Verified Access controls writes. An uncertain create recovers the same
request instead of issuing another. Failure preserves the draft or local record.

Queue moves single work from List to `Queued`, assigning `queueOrder`. Start
shaping records a `shape` launch intent and the shaping settings, then starts
the thread at the Project root. The board resolves the intent to a thread and
moves it to `Shaping`. Group capture stays in its group; the same queue state is
visible there. A fresh concept capture may wait unqueued, but a decision or
build created while working that concept is queued immediately.

Pick-up resolves the ID with `skills/shared/scripts/work.sh`. It reads `read`,
`context`, relevant bodies, parent, children, blockers and Dependencies. `gate`
refreshes a claimed passing Spec. A current approved digest goes to Ready and
ends shaping; Reshape uses `invalidate-gate`, retains text and requires approval
again. A decision routes to its method. Other work starts Explore, which reads
existing project instructions, code, glossary, ADRs and local Project roles.
Explore returns facts and affected repositories, normally without broad checks.
Pick-up ends when the route and evidence are recorded. Lookup failure creates
an actionable error and launches no replacement record.

### Size-up

After exploration, the owner presents the outcome, affected repositories, open
questions and proposed route. It waits in Needs you for Pedro's explicit
confirmation, even for a detailed issue. The desk says Confirm understanding.
`confirm-scope ID --revision N --file F --identity person --evidence response`
keeps the stated files, named tests, behaviour, exclusions, size and Verify decision
as structured local data alongside the item's title, original context and explicit
understanding response. Empty lists and null size leave unstated constraints open.
Verify is only for visible UI behaviour a person must check, not routine CLI output.
`confirmed-scope ID` reuses this capture; an explicit amendment saves a new version
and invalidates prior gates. Reuse confirmation only when that understanding is unchanged.

The owner records Kind with `update --kind`, then runs `kind-disagreement`.
Only Pedro's yes permits `change-kind`; a no uses `record-kind-answer`.
An access problem is reported without blocking local shaping. Confirmation
restores Shaping and routes a bug to Diagnose, unresolved decisions to questions,
settled work to brief, or work too unclear for one session to concept refinement.
Repository count alone never makes work a concept.

### Grilling and questions

An unresolved product choice starts a questioning round. The owner reads prior
answers, the concept destination, decisions and sibling briefs before asking.
It asks the whole frontier whose prerequisites are settled, with recommendations.
Facts go to Explore or Research. Questions dependent on an unanswered question
wait for the next round.

The question stage saves the question reference, reason and resume Status,
sets Needs you and waits. Answers go into the decision's `answer`, or the brief's
Confirmed section or the map's settled decisions. Gate approval is the exception;
it goes only in digest-bound gate evidence. A tool approval also waits on the
desk and resumes only after T3 records its resolution. Silence is never approval.
The round ends when all its answers are stored and Status returns to Shaping,
In progress or Review. Grilling ends when no unresolved branch remains.

### Diagnosis, research and prototypes

Confirmed bugs start Diagnose. It reads the failing behavior and code and returns
the cause, evidence and a failing test to write. Missing product decisions return
to questions. Shaping does not implement the fix.

A factual uncertainty starts Research against primary sources. It stores findings
on a `research/<slug>` branch and records the branch and sources in the decision's
`answer` or brief references. Concept research can run in the background while
independent questions proceed. Its parent records the task association and waits
for its complete result before accepting evidence.

A look or interaction question starts Prototype in an isolated worktree, with
two or three variants differing only on that question. A logic/state question can
use an HTML page. It returns its branch, worktree and variant commands or HTML
paths, with no server left running. The owner presents the variants and waits
for Pedro's pick on the desk. It saves the pick in Confirmed and the branch in
Notes for the builder. Prototype code stays on its branch as a reference.

Each role records its result and uncertainties. Heavy commands use
`lar-work heavy -- COMMAND`; checks use `run-check` when they are build validation.
An interrupted command is unfinished, never passed. The stage ends with accepted
evidence or a saved question, not with a product commit.

### Brief

Gate presentation checks completeness before offering single or batch approval.
Bug briefs name cause, evidence, affected files, a named regression test and
red-before-green; Feature and Improvement briefs name acceptance, affected files
or areas and named tests. Empty/placeholding sections fail with the missing
section names. Generic Build/Issue delivery briefs use the same acceptance, affected files and named-tests checks. Linked parents have no delivery gate.
Doubt judges the substance after this mechanical check.

The displayed approval offers Request changes for one brief or the whole batch.
The board records the operator, time and note, returns each item to Shaping and
sends the note to its recorded shaping owner, falling back to the group/decision owner. A batch sends one change note per owner, separately from approval notifications. Existing approvals remain history;
the request itself invalidates none. Failed delivery remains visible and retryable.
Active shaping offers Stop: interrupt its owner and retain the item and records.

Settled work starts brief drafting. The owner reads accepted answers, evidence,
affected sibling contracts and the Project's `domainDocs` setting. It saves
`brief` with What, Done when, Confirmed, essential Notes for the builder,
Domain docs and Verify. `confirmed-scope ID --markdown` renders the authoritative
Done when, Scope and Verify sections. `brief-scope-check ID` compares their claims
with the confirmed scope, reports missing/extra claims and exits nonzero on a
mismatch or absent confirmation. Brief drafting, Doubt (given the work ID) and the
final pre-presentation gate check all run it. A captured scope also fences
`gate` display and `record-gate`, including every batch member; legacy records without a capture retain their existing gates.
Other prose and semantic consistency still require Doubt's judgment.
Acceptance criteria describe observable outcomes.
The brief contains everything a builder needs without the shaping conversation.
Scope names affected files and Notes name essential shared contracts so overlap
checks and other builds can find the work they must account for.

Domain docs OFF means no drafts and `none`. ON means draft glossary entries and
ADRs in the record for the build PR. Shaping writes no product glossary or ADR
files. Editing a brief invalidates its gate. The stage ends with a saved digest
ready for Doubt, shown as Awaiting gate inside Shaping or the group. Decision
threads use this same route for every draft build. A decision answer or a Ready
status alone cannot authorize a proposed child build; Start build rechecks its
current gate before recording a launch intent.

### Gate with Doubt

The owner runs `gate ID`, examines `specSync`, resolves held edits, then rereads
the brief and revision. Read failure preserves the local copy with a warning.
It runs `build-overlap`, checks shared contracts and records blockers for builds
that change the same files or conflicting contracts. This check includes work
outside the concept and standalone Ready tickets.
`doubt-package ID` supplies the exact brief and an affected-work package:
destination, current decision answers, sibling and overlapping briefs, blockers,
Dependencies and release constraints. It receives no shaping conversation. It
challenges claims against code, acceptance criteria, contracts and ordering.
`Files:` and `Contracts:` lines in briefs declare exact backticked names.
`build-overlap ID` proposes edges for matching files in one repository or matching
contracts across repositories. It recognizes existing transitive ordering and
leaves semantic judgment to Doubt. The owner records blockers, or explains each
unordered overlap with `record-doubt ID --digest H --identity I --evidence E
[--file ordering.json]`. That command binds a clean review to the current package.
Gating rechecks it atomically. Only the brief, cited product answers, consumed
contracts, confirmed scope and named Dependency/release contracts invalidate its
review and approval. Delivery progress and unrelated projections do not.

The owner fixes factual defects and records the result. Unresolved choices or
findings go to Pedro through the question stage. Scope changes run group
reconciliation before another gate. Doubt reruns on changed reviewed text.
When the brief is final, the owner displays its complete text and exact digest,
asks Approve brief and waits on the desk. `gate-batch --file ids.json` produces a
manifest of every complete brief, source revision, brief/approval digests and Doubt identity/result. Display it verbatim;
one yes covers exactly its manifest digest.

The `gate ID` command returns `display`: complete brief, source revision, brief
digest and approval digest. Save that object, display its text and approval
digest verbatim, then record explicit approval with `record-gate ID --file
display.json --digest H --identity I --evidence E`. The command rereads the
ticket and rejects changed displayed text, source revision or approval digest.
`record-gate-batch --file manifest.json --digest H --identity I --evidence E`
refreshes every ticket, rejects held edits, and rechecks every source revision,
brief/approval digest and current Doubt package/result inside one transaction.
It records all gates and Spec outboxes atomically, with a shared batch digest. Any
mismatch records none. Changed text requires renewed review and approval.
Successful gates move builds to `Ready`. They stay blocked if `waiting-on` is
nonempty. No build starts merely because shaping finished, except through an
already enabled automatic policy below.

With Write the refined spec to the issue ON, eligible builds queue the complete
approved brief as Spec and preserve Original. Concepts, decisions and slices do
not publish their local structure as Specs. A failed Spec write is durable,
shows Pending Spec sync with Retry and does not block Ready. Trusted tracker
Spec edits refresh the local copy without changing Status; unverified GitHub
edits wait for Accept or Reject. A build keeps its starting snapshot if the
tracker changes later.

Today: the current ticket sync path mostly covers already active Specs, so edits to starting ticket text also need
coverage before pick-up. Build-start Spec reads can replace locally reviewed
text; the target requires a current gate for the exact snapshot launched.

## Concepts and linked work

### Create and reconcile parts

`lar-work choose-structure ID` reads the confirmed scope's `repositories` and
`openDecisions` and returns the structure with its reason. Several repositories
with open product decisions the item does not settle become a Concept, with
those decisions as parts. Settled scope across several repositories becomes
linked work, with one parent, one build per repository and blockers by dependency.
One repository keeps a single flow. Legacy scope without those fields needs an
explicit confirmed amendment before the command can choose.
Release and activation steps belong on the parent as release steps.

A concept starts when size-up identifies investigation too large or uncertain
for one session, or Pedro captures a concept directly. The concept owner reads
its destination, boundaries, open questions and all child records. It saves
`map` and Kind `concept`. Decision text names `Method: grill`, `prototype`,
`research` or `task`. The board calls grill Clarification. A task is a bounded
pre-task, not permission to put ungated product implementation in a decision.

Within an authorized destination, a concept or decision thread adds, merges,
retitles or sets aside proposed builds without asking whether to keep each one.
It reports what changed. A new product choice, conflict with Pedro's decision
or expansion of scope still goes to questions. The same authority and question
rules apply to changes affecting active builds.

Before a concept owner ends a shaping turn, it removes resolved Fog and settles
factory details such as fixture files and presentation itself. Each remaining
Fog bullet has a live route: `[decision: ID]` names an unfinished decision,
`[factory: ID]` names a task decision actively in Shaping, or `[question: ID]`
names this group or a direct part with a pending question and saved Needs you
visible on Your desk. Pedro answers in T3. Queued factory work uses a decision
route. A map write with Fog clears the gone flag; `set-fog --fog gone`
refuses a map that still contains Fog. Missing, retired or completed owners and cleared questions are mechanical
`reconcile` holds; they cannot be acknowledged away. The board counts only live
routes as open questions and calls unrouted leftovers Fog to reconcile.

For a new part, use `lar-work create-part --parent ID --revision N --title X
--repository R --kind build|decision --file F [--blocked-by ID]...`, where N is
the parent's last-read revision. It creates the decision or build in its explicit
repository with its parent, body, blockers and Queued state in one transaction.
A stale parent or failed write leaves no part or changed relationships.
`slice.sh` calls it when given `--kind build|decision --repository R`; without
`--kind`, buildable work keeps its private slices in the parent's repository.
The proposed `amend-group` extends this to an affected-record change set.
An unblocked queued build is ready for shaping, not implementation. Missing Project onboarding or Access
shows the exact hold. It never silently puts new children in List. Ordinary
standalone captures continue to start in List.

For a decision, the owner saves its `answer` and `domain-drafts`, including
`none` when disabled. It rechecks affected briefs, sibling interfaces, blockers,
Dependencies and ticket projections. It runs `build-overlap` for affected builds
and checks shared contracts against other concepts and standalone work. It
records blockers for shared files or conflicting contracts across those
boundaries, with expected revisions for every affected record. It updates the map
after incorporating those answers. Superseded decisions retain history but show
which current answer replaces them. An affected passing gate becomes invalid, even when only its
assumptions or sibling contract changed. Ungated briefs return to shaping/gate;
unaffected gates retain their evidence.

Merging proposed work records saves `supersededBy` on the absorbed record,
moves its acceptance criteria and relevant context into the survivor, redirects
incoming blockers, combines prerequisites and rejects cycles. Setting work aside
examines every dependent. The agent must replace, justify removing or retain each
edge with an explicit unresolved hold. Neither operation pretends work merged.
Both preserve tickets and history; closing a tracker ticket is a separate choice.
An active build affected by a scope change pauses for reconciliation and a fresh
gate. The running `buildInput` is never silently rewritten.

`lar-work reconcile GROUP_ID` derives a fingerprinted checklist from the group's
records, current Doubt packages and its last clean snapshot. It lists changed
answers (including supersession), brief/scope/contracts, map nodes, Dependencies
and release steps with before/after facts. It checks missing overlap ordering,
redundant blocker paths, unincorporated answers, stale approved gates, held ticket
edits, ticket title/Spec mismatches and pending/failed approved writes. The group
shows **Out of date: N items** immediately after a recorded change, including
changes read from a ticket. Compact summaries group the work to re-check with
expandable item names; full instructions remain in the thread checklist.
No tracker request runs inside this command.

The thread follows `skills/shared/reconcile-group.md` after each decision, gate,
scope change, set-aside, merge-build and observed PR merge. It repairs the records,
reruns affected briefs through code evidence and Doubt with `doubt-package`, and
requests Pedro's board approval only when a gate needs approval. It records each
source-change review with `resolve-reconcile GROUP_ID --item KEY --digest H
--evidence TEXT`. Changed fingerprints refuse stale acknowledgements. Mechanical
holds clear only when the recorded condition is fixed; the next reconcile records
them done. A clean checklist checkpoints the new baseline, preserving completion
evidence. Semantic agreement remains the thread's and Doubt's responsibility;
commands compare declarations and recorded evidence, never infer prose contracts.

`set-release-plan GROUP_ID --revision N --file F` uses the parent delivery plan:
`{steps:[{id,who,what,shipsWith?:[work IDs]}],outcomeCheck:"observable check"}`.
A ships-with release step names at least two active delivery parts, such as the
server and app changes that must ship together. The map and parts view show their
names in the same release plan. Reconcile flags removed/set-aside members and
merged pairs still lacking release evidence. Use the existing
`complete-release-step` and `record-outcome-check` commands; PR merge is never
release evidence. Invalid members prevent delivery completion even if old evidence
exists. Release contracts enter Doubt's digest; later evidence alone does not
invalidate a reviewed contract. No second release store is introduced.

Reconciliation ends only when affected records agree, affected gates are marked,
and every required approved Spec write is queued or its failure is visible.
Changed ungated text stays local until approved. The ticket keeps the last
approved Spec and the group shows Out-of-date Spec. Preparing the group for
Build includes gating those changes.
No view claims an ungated ticket already contains the new approved scope.
The tracker keeps the approved bytes and Original, adding a visible Out-of-date
Spec notice outside them. That notice is removed after renewed approval and sync;
failed writes retain a visible retry state. Before a Spec exists, trusted ticket
body/title edits refresh the starting request in the record and pick-up/details,
without creating a brief or gate. Unknown GitHub provenance uses the same held-edit
accept/reject path. Read failures retain the last trusted request with a warning;
a running build keeps the starting request frozen in its launch input.

Linked work uses the same operations and blocker graph across Projects. Each
delivery build changes one repository. Work in an onboarded repository becomes
a build there within the authorized scope. Work owned by another team becomes a
Dependency with need, owner, contract, evidence and handover. `add-dependency`
and `add-dependency-block` record it. Only Pedro's `mark-met` releases it;
observed ticket closure or PR merge does not. `replace-dependency` can replace
the hold with an onboarded build atomically.

Today: `create-part` and `slice.sh` create complete Queued delivery parts in any
named repository. Ordinary `create` still defaults to List; private slices keep
their existing behavior. There is no supported group amendment, merge/retitle
operation or automatic affected-brief audit.
`set-aside` leaves edges for manual repair. Decision completion relies on body
and map write times. The target records the incorporated answer revision.

### Map, blockers and buildable order

Map prose holds destination, settled decisions, open questions, boundaries and
domain drafts. Nodes, statuses, queue flags and edges come only from records.
The generated map uses current answers, not superseded text. `work-order` exposes
the same compact view to agents and the board, including why each item waits.

`add-blocker`, `remove-blocker` and group amendments reject self-edges and cycles.
They report an already implied edge instead of silently storing a redundant one.
Topological ordering uses prerequisites first, then `queueOrder`, `createdAt`
and `workId` for ties, with null queue positions after numbered positions.
Unqueued items remain visible and cannot start
automatically. `waiting-on` reports incomplete blockers and unmet Dependencies.

At each gate or decision, agents record blockers for builds that change the same
files or conflicting contracts. `build-overlap` detects overlap in named files;
agents choose the order and check contracts. The graph includes other concepts
and standalone builds, even when the conflicting contract spans repositories.
Commands enforce those recorded edges. Every build has its own worktree. Builds
in the same repository can run together when no blocker prevents it.
A blocker means merged work, not released software. `set-release-plan ID
--revision N --file F` saves ordered `steps` with `id`, `who` and `what`, plus
an `outcomeCheck` describing the final observable check. These records belong
to a linked-work or concept parent. `complete-release-step` records the named
step's done evidence and identity after preceding steps are done.
`record-outcome-check` records passed or failed with evidence after all steps and release.
Once every active part is complete and all release steps have receipts, the board
queues one durable Outcome check to the group owner (or its decision owner), for
concepts and linked work alike. T3 dispatch retries reuse the stored command and
message IDs. The owner checks actual merged revisions together and records commands,
results and merged SHAs with `--input-digest` from that dispatch. Changed delivery
inputs reject the receipt. Passing evidence lets the board finish the parent.
A missing owner, dispatch error, failed check or owner ending without evidence
puts Record Outcome on Your desk and in the parent dialog. Pedro records passed
or failed with evidence through that board button. Reconcile reports the pending
Outcome as a mechanical hold; merges alone never establish its result.
A future Outcome criterion never holds refinement. The board shows planned
checks separately and reaches release/Outcome waits only after delivery builds complete.
A changed plan needs fresh evidence; previous versions remain in the database.
Parent completion reads its parts, explicit human holds, unmet Dependencies, release steps and Outcome
check. It does not require a parent PR. A concept also needs its Fog gone.
The group and item details show the ordered steps, evidence and what remains.
A release prerequisite uses an explicit hold, never an assumed PR merge.

`refinement` completes when the map exists, open questions are recorded resolved
with `set-fog --fog gone`, and all active decisions are incorporated. Builds may
still be ungated. Delivery completes only after active builds and decisions are
complete, release steps are met and the Outcome check passes. A concept with no
active builds has No delivery planned. The board derives Done from completion,
including for decisions; agents do not force Done with `status.sh`.
An unmet release step or failed Outcome check keeps delivery incomplete after
all PRs merge. It does not reopen completed builds or add a merge blocker.

Today: the board generates map parts, live status, queue membership, gate state
and blocker/Dependency edges from the records. Map prose supplies destination,
choices and boundaries, never graph facts or Dependencies. `children` is verbose
JSON; there is no compact CLI view or dependency-aware queue order. `refinement`,
`completion` and `waiting-on` exist. Release steps and Outcome check evidence participate in structured completion; the board dispatches the final check after its prerequisites complete.

### One action, shared capacity and Auto-build

Start concept builds is enabled when refinement, decisions and pre-tasks are
complete, every active build has its own approved gate and the graph is valid.
Every prerequisite needing Pedro, including external Dependency acceptance,
must already be met. Remaining automatic release waits are shown before Start.
The action saves `buildRun: running` with the prepared record
revisions. Pause concept builds stops future starts and preserves active work.
A new scope change pauses the run until affected gates pass again. The run compares
scheduling contracts (parts, scope, gate digests and blockers); projection whitespace
and Notes do not change its authorization. Status/history prose and answer
revision citations do not enter the signature; chosen answers and product
contracts do. Once all parts are complete the build
run is completed, while release and Outcome may still wait.

The scheduler never builds an ungated Queued record. A running concept starts
all eligible Ready builds together up to the shared capacity. Blockers determine
which builds can run in parallel, including across repositories. Each PR appears
on the desk. A confirmed merge satisfies its blockers and starts newly eligible
builds without another Go. The concept can have several unmerged PRs. If only
automatic waits remain, the group shows them. A required human action also
appears on the desk. The concept finishes after delivery and Outcome check.

Concept builds stay in their group; standalone Ready work stays in Ready to
build. Both draw from the existing machine build limit through one scheduler.
The limit reflects the machine's hardware capacity. Each build runs in its own
worktree, so a repository is never reserved. Blockers prevent conflicting work
and can cross the concept boundary. Unblocked builds can run together in the
same or different repositories up to the shared limit. A parked branch must
rebase and pass the same eligibility and capacity checks before resuming.

The shared build limit counts starting or uncertain launches, In progress,
Review and builds at work again after handback, as today. PRs merely waiting
on Pedro release active capacity; their dependents still wait for merge. Starts
from the desk, group, standalone section, Start after and Auto-build all obey
the same capacity and eligibility checks. When capacity is short, choose among
all eligible standalone work and running concepts' builds by oldest passing
gate, then work ID. Each start claims capacity atomically. Blocked candidates
do not hold up eligible work, including in the same repository.

Auto-build is the machine switch for starting eligible Ready builds without an
individual Go. It uses the same scheduler and cannot bypass a gate, a hold,
blocker or capacity. Under a concept it requires complete refinement and
uses the same parallel start rules. Turning it OFF stops future automatic
starts; an explicitly running concept continues until paused. Ordinary holds
retry when facts change. A refused start pauses that item until a successful
manual start or a new gate. Uncertain launches retain their intent and capacity
until recovery proves the outcome. Only one board owns automatic scheduling.

Today: Auto-build is OFF by default. Start concept builds saves the run after
one complete preflight; Pause and scope changes stop future starts. Manual
Start, Start after, concept runs and Auto-build use the same transactional
eligibility and capacity claim, with frozen approved input. The group uses the
same deterministic build order as `lar-work work-order <group-id> [--json]`.
Provider-confirmed PR merges unblock successors through the shared scheduler;
closed tickets, thread completion and failed PR reads do not. Concept views
show active builds, capacity waits, blocker waits and PR merge waits.

## Building stages

Stage events remain proposed. Build phases are recorded by the commands that
start or finish their steps: build dispatch, role launch/finish, reviewer selection
and retro preparation. `set-phase` remains for direct Small implementation and
compatibility; entering Review changes its phase and Status atomically.
Domain-docs and checks role launches record `domain-docs` and `full-checks`.
Approver launch records `approve`; its successful finish and CI fixer launch
record `checks`. Failed roles never advance their phase; repeated commands reuse
evidence without rewinding it. Fixers keep the step they serve.
The build thread uses build settings. All delegated roles use the saved role
settings and report only after their work and descendants are complete.

### Start build

Pedro's Start build, Start after when its prerequisites complete, a running
concept or Auto-build requests the same start command. It refreshes the ticket
Spec, reads the current gate and blockers, checks T3 Project availability,
Settings, Access and capacity, and calls `prepare-build`. A changed digest
returns to gate. Held edits wait for Accept or Reject. Read failure uses the
last gated local copy with a warning.

The board fetches the resolved default branch from origin. Fetch failure or a
two-minute timeout refuses launch. It snapshots selected project skills with
`snapshot-skills`, the run settings and `buildInput` with approved brief digest,
group contract revisions and fetched base SHA. It starts a new isolated worktree
from that fetched remote tip, using `fix`, `feat` or `chore` plus ticket/ID and
title for the branch. Local default-branch commits do not become its base.

`record-intent`, `resolve-intent`, `set-build-branch` and `add-thread` keep the
launch recoverable; retries reuse its identity. Saving the build launch request
records `plan` before T3 can start the builder, including for Small builds.
A successful launch sets the build In progress and the concept In progress;
a resumed build keeps its phase, and a replacement starts at `plan`. A stopped
build still in the dispatch plan can retry only before it has slices or a PR;
the system-recorded plan alone is not evidence that implementation started.
The board then applies the saved Shaping thread cleanup choice. During launch it says Starting build; failures
show their cause in the original section or group. Start ends only with a
recorded thread, a proven refusal or an explicitly uncertain intent.

### Plan

The builder reads the approved `buildInput`, initial context, project rules,
selected project skills and referenced research/prototypes. It starts no work
from an unapproved brief or the shaping conversation. Planning uses phase `plan`.
The builder judges whether this is a Small build: one change, or parts touching
the same files. It records that route and implements directly without slices.

Other builds start the planner; its role launch records `plan` and successful
finish records `implement`. It saves private slice briefs and blocker edges
with `shared/scripts/slice.sh`, using the build's repository and parent ID.
Commands validate the graph and
return ready slices. Planning ends with a recorded Small build route or a slice
plan. The board says Planning and shows slices only within the build.

### Implement and integrate

Launching an implementer records phase `implement` for ready slices, each in its own
worktree from the local build branch. Reconcile existing slice/thread associations
before launching to avoid duplicate attempts. The planner may re-slice a blocked
slice, one planner at a time. A rebase conflict is not a reason to re-slice.
Small builds set phase `implement` before the builder edits. Each `set-phase`
command asks the local boards to read immediately. Both follow project conventions and
test-first guidance where appropriate, commit their work and run focused checks.

The builder fast-forwards each successful slice into the build branch, then uses
`finish` to complete it. Failed fast-forward returns that slice for rebase and
focused conflict checks. A merge that succeeded before a record failure is
reconciled without implementing again. Unresolvable conflicts or a wrong brief
save a Needs you notice and wait on the desk. Wrong scope returns through the
shared brief, reconciliation and gate stages.

Implementation ends when all active slices are integrated or justified as set
aside, or the Small build is committed. Finished slice worktrees are removed
only after checking ownership and thread inactivity. A kept worktree retains
its recorded reason and does not stop the build.

### Domain docs and checks

Phase `domain-docs` reads the saved domain-doc choice. ON starts the domain-docs
role to write the brief's glossary/ADR drafts into the build PR. OFF writes none.
New build decisions follow the same rule. The builder records the resulting
Domain docs added by the build list for review and approval.

Phase `full-checks` starts checks. The role saves applicable commands and folders
with `set-check-list`, then runs each through `run-check --role checks` on the
integrated tree. `checks` holds outcomes, tested tree, times, log references and
reuse reasons. `describe-failure` records diagnosis; `resolve-failure` closes a
failure with cause or fix. A later pass alone does not close it. Fixer uses
focused tests and reruns the failed check without repeating unrelated suites.

Missing checks get one recovery attempt; still missing or unexplained failures
wait on the desk. Required project checks remain binding. `reuse-check` requires
an eligible earlier result and a reason for the current tree. The phase ends
with complete passing validation and no unexplained open failure. The builder
pushes the branch before review; no PR exists yet. The board says Checking.

### Each review

`select-reviewers` starts Review with Status and phase `review` in one transaction,
then returns its choices from the saved settings and whole-branch diff. Each selected reviewer runs independently
on that diff. Code checks correctness, design and project conventions. Security
checks trust boundaries and abuse cases. UI runs the app and checks every
affected state and layout, returning screenshot paths and process ownership.
Performance checks rendering, polling, queries and data costs. Custom reviewers
follow their saved instructions. All report verdict, findings and what they
could not check. The board names running reviewers and shows completed results.

Code may request a skipped reviewer when it spots a change that reviewer covers; the builder runs it once and records Code's ID and reason as the reviewer's `escalation`, with Settings' `never` always winning.

The builder records round 1 through `record-review-round`, including skipped
reviewers, base SHA, `approve` or `changes`, `notChecked`, finding severity and
disposition. It judges findings, justifies rejection and gives accepted findings
to fixer. `set-disposition` marks actual fixes. Fixes are fixup commits with
focused validation.

Round 2 runs only reviewers whose findings were fixed. Each gets every round-1
fix since the saved base, its own fixed findings and no unrelated branch diff.
The same saved reviewer settings apply. Record its results and fix accepted
findings, with no third round. Review ends after round 1 if nothing was fixed,
otherwise after round 2. Remaining findings and unreviewed round-2 fixes go to
the approver. Stop only UI processes whose recorded ownership still matches.

Today: review records accept built-in and saved custom reviewer IDs; actual
role-setting evidence remains to be added. The two-round policy already exists.

### Approval and PR

Phase `approve` starts the approver with the brief, final reviewer results,
rejected and open findings, unreviewed fixes, domain-doc list and out-of-scope
work. It fetches the default branch, rebases with autosquash, and assesses every
listed check against the final tree. It records its own justified reuse or
reruns that check. An earlier role's reuse reason is insufficient.

It pushes with a lease and opens or updates one PR following project rules.
The PR describes the outcome, decisions, validation, open findings, unreviewed
fixes and out-of-scope work. It closes only its own ticket when applicable,
never the concept parent. It records `pullRequest` with `set-pr` immediately
and links the PR to the thread. Ticketless builds can deliver PRs.

The approver recommends Verify for visible changes, the brief's Verify request,
auth, permissions, migrations, deployment, unchecked areas, open findings or
failures, or unreviewed blocker/should fixes. Otherwise it recommends Ready to
merge. Verify includes numbered Test steps with observable results. A configured
skipped review is disclosed; its absence alone does not force Verify.

A conflict or failing check returns to fixer and reassessment. After two failed
restarts, or a delivery rule/access refusal only Pedro can resolve, the item
waits on the desk with branch and brief preserved. Approval ends with a recorded
PR and recommendation, or that explicit hold. Status remains Review while checks
run; approval here is an agent assessment, not Pedro's gate approval or merge.

### CI and CI fix

Phase `checks` watches the PR and reads required checks on its current head.
While they run, the board says Waiting for required checks without a desk card.
Green required checks apply the approver's recommendation. Non-required failures
do not start a fixer or block that transition.
The builder writes Verify or Ready to merge before ending its turn when checks
are green, including after a CI fix. Finished runs clear their tool activity;
the board shows the item's next step.

A required failure or branch conflict starts CI fixer with that job's run link
or conflict evidence. It diagnoses first, fixes code or title as needed, uses
fixup/autosquash and focused checks, reruns the failed check and pushes. A changed
final tree requires an updated approver assessment of all listed checks; it does
not restart reviews. CI fixer updates the PR's Checks section from the validation
record. Infrastructure failures change no code.

Infrastructure, an unfixed result or another failure after two CI fixer runs
sets Needs you and stops the watch. The desk names the job or conflict and offers
the next action. Pedro can request a rerun, another fix or a stop. A response
resumes Review and the check watch. The stage ends at green required checks and
Verify/Ready to merge, or an explicit Needs you hold.

### Verify, merge and handback

Verify puts the PR and Test steps on the desk and keeps the item in Build or its
group. `verification` stores the tested head, result, local operator identity, time and
PR Test steps. Pass and Fail Verify are available on the desk and in item details; a failure requires a short note. A failed Verify returns to this build, preserving its PR; fix, checks
and focused checks follow. Every new head after a Verify rejection runs
`select-reviewers` before reassessment. Selection version 2 compares the last
recorded reviewed head (`review-rounds`' latest `base`, within the frozen run)
to the new head, overriding a supplied whole-branch base. Saved `always` modes
run (Code defaults to always); conditional reviewers run only when their versioned
triggers match that delta or its impact is uncertain; `never` still wins. The
existing version-1 path/text predicates stay unchanged. Each result records the
Verify rejection, exact delta, trigger version and run/skip reason. The round
records the selected new head and all selection evidence, including skipped
reviewers. This is a Verify reassessment, independent of whether an earlier
reviewer finding was fixed; the two-round finding-fix rule applies within each
review cycle. The approver always reassesses the final tree after those reviews,
even when every configured reviewer is skipped. A pass permits Ready to merge. A later
head change invalidates that verification. History labels every older-head result
as superseded by the current head. Transient pending reads and build-activity
guards retry automatically, keeping results disabled until inspection succeeds. An already merged build is never
reopened; new work gets a new record.

Ready to merge offers Merge PR on the desk. Pedro chooses the provider's merge
method and confirms the exact delivery PR/head. The board rechecks required
checks, head, conflict state and Access before submitting. Agents never merge
for him. Only a provider observation of the recorded PR as merged, saved with
`observe --of pr --state merged`, completes a build and records `finishedAt`.
A closed unmerged PR or failed read preserves the work and shows its real state.

A confirmed merge satisfies its blocker edges, releases any active capacity,
refreshes affected group views and schedules newly eligible builds in running
concepts or Auto-build, including dependents outside its concept. A ticket
closure, Status change or thread ending cannot do this. Merge confirmation also
reads the ticket directly and refreshes its saved observation, bypassing cached
open ticket lists. Done records continue using direct ticket reads. An open ticket
stays open; a failed read retains the last observation with its read failure.
Unmet release holds remain unmet after merge.

After confirmed merge and **Done**, the board records phase `retro` with retro
preparation and resumes the same build thread once. It records the complete suggestion list. One
**Choose follow-ups** desk card shows their count and opens item details, where the full list records Pedro's selection through
**Create chosen follow-ups** or **No follow-ups**. Selected follow-ups become List
records/tickets using each destination's saved retro setting. No suggestions
means no desk card. The source build stays **Done**. This wait does not block other concept builds or its delivery completion.
Cleanup and capture failures remain visible.

Today: PR merge is guarded and provider-confirmed. Verify has no structured
head-bound evidence record. One-action parallel concept runs and scheduling
dependents across concept boundaries after merge need implementation.

### Handoff and recovery

A thread nearing its context limit, currently about 150k tokens, saves its stage,
decisions and output references before handing off. Build stops new planners and
implementers, settles or cancels owned tasks and integrates completed slices.
It carries the Small build route, current review round, unreviewed fixes, domain
docs and owned UI processes. Live task IDs are not reusable in a new thread.

The continuation records its thread on the same work ID and keeps `runSettings`.
Shaping resumes at the Project root; building resumes in the existing build
worktree and branch. It reads records, slices, validation and PR before choosing
the next action. An unfinished role gets only its missing work repeated.
No handoff creates a duplicate PR, repeats a valid approval or turns unfinished
checks into passes.

Start again is only for a thread T3 confirms deleted. The board preserves the
work ID and offers the recorded branch/worktree or an explicitly new build
attempt. It reconciles unresolved launch intents first. A quiet thread or T3
read failure alone never proves deletion. A genuine missing decision waits on
the desk; a routine handoff keeps the current stage and placement.

For a resolved model, the board saves its exact launch request and uses the intent
ID as T3's command ID. An interrupted launch replays that request, including after
a board restart, so creation and the first message resume on the same thread.
Until the first user message and a run past preparation are confirmed, the start
request returns HTTP 202 and the board shows a pending launch. It retains the
intent and replays the same command; no new thread is started on another press.
A confirmed refusal returns a failure. A matching empty
thread from an older launch is reported as unsent, never missing.

A scope amendment can temporarily leave the previous brief out of date. The board
continues refreshing that work and offers approval only after the brief matches
confirmed scope. Local refresh warnings identify the failed operation and, for a
refused record read, the work ID and reason. They retry automatically and clear
when that operation succeeds; an upgraded database requires a restart.

The board retries T3 project reads while disconnected and rediscovers a restarted
server's current process and address. Recovery refreshes project launch holds,
project defaults and model choices independently of tracker reads. A disabled
Shape shows its reason beside the control. Diagnostics shows the authenticated
T3 project connection separately from the CLI and board server; Run checks opens
a fresh connection. Retained observations never authorize a launch.

A delivery approval binds its brief and confirmed scope, cited decision answers,
named sibling contracts/file overlaps, declared prerequisites, its blocking
Dependency contracts and release steps that name it. Unrelated group growth,
map edits, sibling Notes, Dependency rollout evidence and other parts' release
steps do not invalidate it. Doubt still displays the whole affected group for
semantic review. A still-current approval from the prior digest format migrates
only after rechecking its original digest; stale evidence stays stale.

Linked parents have no delivery gate or parent Approve brief card; only their
builds do. Every invalid delivery gate has an Approve brief desk notice, including
while its old brief awaits a confirmed-scope amendment. That notice names the
scope repair needed before approval can succeed. Board single/batch approval
moves eligible members to Ready in its gate transaction and queues a durable
notification to the same owner. Lost notifications retry the same T3 command on
refresh, including after a board restart. Active builds keep their thread/branch.

`choose-structure` records Concept for an open multi-repository destination and
Build for settled linked work or a standalone delivery. `select-reviewers` saves
its exact diff/run-bound output with the Review phase. `record-review-round`
fills per-reviewer selection, escalation and configured skip reasons from that
output, validates verdicts against it, and treats empty unchecked notes as absent.
Round two uses that recorded selection for the reviewers checking fixes.

## Skill context by thread kind

Assembly copies `skills/shared` into each installed skill. Paths below refer
to source files; threads receive absolute installed paths, the exact data folder
and `lar-work` installation, and pass them to every role. Each thread reads prose
rules once. Agent-document edits additionally read `shared/write-agent-docs.md`.
Load step files only on reaching that step, never the whole workflow up front.

| Thread or role                               | Files to load                                                                                                                                                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shaping                                      | `lar-shape/SKILL.md`, `pick-up.md`, then `size-up.md`, `brief.md` and `gate.md` as reached. `shared/issue-tracker/work-records.md` supplies record operations.                                                                                            |
| Concept                                      | The shaping entry and pick-up, then `concepts.md`. Load question, research or prototype steps only when used. It does not load build orchestration to prepare a map.                                                                                      |
| Decision                                     | The shaping entry and pick-up's decision route, `concepts.md`'s Decisions section, and only its named method. A Clarification uses `grilling-with-docs.md`, `grill.md`, `shared/questions.md` and `shared/domain-docs.md`.                                |
| Gate-only                                    | The shaping entry's common rules, `gate.md`, `shared/questions.md` and the record guide. Doubt loads `lar-shape/agents/doubt.md`, orchestration and supplied record references. It does not load grilling or concept research.                            |
| Linked work                                  | The owning shaping/concept/decision entry, the record guide's Other repositories and Dependencies sections, and proposed `shared/reconcile-group.md`. Structural publication guidance is needed only for a publication question.                          |
| Build                                        | `lar-build/SKILL.md`, `agents/builder.md`, `project-rules.md`, the record guide and snapshotted project skills. Load `test-first.md`, `coding-style.md` and `design-modules.md` when implementing, then `review-session.md` only at the post-merge retro. |
| Planner and implementer                      | Their respective `lar-build/agents/planner.md` or `implementer.md`, project rules, orchestration and `shared/issue-tracker/slices.md` as needed. Read only the coding/design guidance their role calls for.                                               |
| Reviewers                                    | Their `lar-build/agents/reviewer-*.md` or saved custom instructions, project rules, orchestration and only the checklist Copies that role loads.                                                                                                          |
| Approver and CI fixer                        | Their respective agent file, project rules and validation record, plus `write-pr.md` and `shared/issue-tracker/publication-pr.md` when delivering the PR.                                                                                                 |
| Any thread asking, delegating or handing off | `shared/questions.md`, `shared/orchestration.md` or `shared/handoff.md` and `handoff-content.md` respectively, only when needed.                                                                                                                          |

Shared stages must become small independently loadable sections/files; this table
sets the required context rather than requiring repeated reading of full guides.
Measure loaded bytes and tokens per thread kind before and after a cut. Keep a
cut only when repeated runs preserve outcomes. Copies change through skill-sync
or an explicit documented Override.

Today: the build entry is already `agents/builder.md`, and step files load on
demand, but concept and decision routes still require large shared guides.
`lar-build/agents/doubt.md`, `brief.md`, `start-build.md` and prototype files
repeat shaping content. They need one instruction home with assembled references.

## Checking a simulation

Before a scenario, record Pedro's destination and answers, the skill revision
and Settings snapshot. At each stage compare its trigger,
record inputs, role settings, output digests, Status, placement, desk actions and
exit condition against this document. Check every view through the UI, including
the map, ticket, Settings and empty/error states. Repeated runs must agree on
structure, blockers, gates, statuses, ticket content and reviewer selection;
prose and implementation details may vary within the same accepted outcome.

Use the fake tracker with `pnpm run sample` or a dedicated sandbox repository.
Never touch real product records. The fake tracker must accept writes, preserve
them for the scenario and support deliberate failures without reaching a real
tracker or data folder. Keep screenshots and simulation artefacts out of product
PRs. Record cleanup ownership in the coordination folder.

Today: sample mode uses fixtures and refuses writes. The in-memory writable fake
tracker with deliberate failures is part of the target, not a proven capability.

Each round reports differences, context sizes and package-test/CI times against
#805's baseline. Remove or cheapen a test only when another check still protects
its behavior. Rounds continue until Pedro says to stop; a successful scenario
does not authorize ending the effort.

## Sources and current limits

The current contracts are in [README](../README.md), [Glossary](../GLOSSARY.md),
[standalone design](plan.md), [skill layout](skill-layout.md),
[shaping](../skills/lar-shape/SKILL.md),
[builder](../skills/lar-build/agents/builder.md),
[shared record guide](../skills/shared/issue-tracker/work-records.md),
[CLI](../packages/work-records/src/cli.ts),
[record model](../packages/work-records/src/work-records.ts),
[board placement](../packages/shared/src/board-view.ts),
[model launch choices](../apps/server/src/t3/model-choices.ts),
[item commands](../apps/server/src/items/item-commands.ts) and
[Auto-build](../apps/server/src/auto-build/auto-build.ts).

Today: `docs/plan.md` still describes structural tracker publication and recovery.
The README and current `sync-structure` command suspend those writes. This target
keeps structure local; it does not restore publication or invent sharing. Ticket
creation and approved ordinary build Specs remain separate supported writes.
