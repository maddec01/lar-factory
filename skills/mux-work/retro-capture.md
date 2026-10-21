# Retro capture

Use after the builder's retro selection, or when Pick up finds an unfinished
capture record. Capture selected work as issues; shaping and implementation
happen later. Preserve the source issue's final status, including during
clarification questions and failures. On resume, use the existing plan and IDs.

## Select and route

1. Capture only Pedro's picks, including clear free text. Concrete selections
   take precedence over None. Clarify ambiguous free text through the question
   UI before any capture mutation, following **Rules**' retro exception. With
   no picks, post a one-line `Retro capture: complete — no picks` on the source
   issue and finish. No suggestions means no selection question or follow-ups.
2. Route each selected suggestion to `maddec01/`:
   - Server work → `mux-server`; Apple work → `mux-apple`.
   - A repository's own `AGENTS.md`, CI or local tooling → that repository.
   - Factory workflow/board, shared/global skills and instructions → `mux-factory`.
   - Global environment, machine-wide tooling/configuration and information
     access without a clear repository owner → `mux-factory`.
   - One suggestion requiring changes across repositories → one `mux-factory`
     concept listing the affected repositories; prefer a matching open concept.
3. Read the destination's issue conventions and visibility/redaction rules
   before drafting titles, bodies, context comments or the source record.
   `mux-factory` is public; `mux-server` and `mux-apple` are private. Every public
   surface, including a Factory source record, must use public-safe descriptions:
   exclude private logs, credentials, private hostnames and sensitive paths or
   details. Include source links only where safe for that audience. Otherwise
   keep identifying provenance only in an access-appropriate private source
   record. Use opaque capture IDs on public destinations reached from private
   work; IDs must not encode private source repository names, issue numbers or
   details. Redact public records' destinations/URLs too when they expose private
   work; keep any necessary private mapping in an access-appropriate private
   record and link it only where safe.

## Persist the plan

Before creating issues or posting destination context, successfully post one
source-issue comment headed `Retro capture: pending`. This replaces the generic
answers comment. Generate an opaque batch ID once (for example a UUID), then a
stable selection ID per pick (`retro-capture:<batch-id>:<index>`). Reuse these
exact IDs on retries; never regenerate them from rewritten suggestion text.

Record enough public-safe context to resume from this comment alone:

```text
Retro capture: pending
Batch: <opaque ID>
Source final status: <status; preserve it>
- Selection: <stable selection ID>
  Suggestion: <selected work and useful context>
  Destination: <owner/repo; affected repositories for a concept>
  Issue: pending | <created/reused URL and which>
  Context: pending | recorded (new issue body or reused issue comment)
  Board: pending | List confirmed (new) | preserve (reused)
  Remaining: <unfinished creation/context/board step or failure>
```

Repeat the selection entry for every pick. Keep the comment's URL/ID so updates
edit that record. If posting the plan fails, report capture pending and stop
before destination mutations. When redaction requires a private companion
record, persist it before mutation too; keep both records' progress consistent.

## Capture and reconcile

For each selection, perform these steps in order, updating its record as each
step succeeds. Retain every returned URL immediately and persist it before the
next mutation. If a record update fails, stop and report the pending step;
reconcile on resume rather than repeating a possibly successful mutation.

1. Consult the record's retained URL first. If absent, reconcile the destination
   against the exact selection ID in issue bodies and comments, then clearly
   matching **open issues in that destination repository**. Inspect candidates;
   search results alone are not proof of absence or a clear match. An issue
   created by this capture may exist even if its URL never reached the source
   record: recover that URL by its marker before creating anything. If the
   outcome cannot be established, leave it pending and report the uncertainty.
   A recovered creation remains **new** for board placement; a recovered reuse
   remains **reused**. Continue its unfinished steps without reclassifying it.
2. Reuse a clearly matching open issue (a concept for cross-repository work).
   Add the new source/context with the selection ID, checking existing comments
   for that exact ID before posting. On retry, an existing marked comment counts
   as recorded. Preserve the issue's status; do not call `status.sh` for reuse.
3. Otherwise create one issue with an actionable title, the selected improvement,
   useful context, safe provenance and the exact selection ID in its body.
   First follow [label setup](issue-tracker.md#label-setup) for the **destination**
   repository, including `mux-factory` for a cross-repository concept captured
   from another Mux repository. Do this after persisting the source plan; if
   setup fails, leave capture pending and retry setup before issue creation.
   Follow destination label conventions (`bug`, `feature`, `improvement` as
   appropriate); capture text is not a passing brief. For a cross-repository
   concept use the `concept` label and the sections in [Concepts](concepts.md):
   Destination (including affected repositories), Decisions so far (only confirmed choices),
   Fog (unshaped decomposition), Out of scope, Map (no sub-issues yet). Capture
   creates neither decisions nor sub-issues and does not start shaping/building.
4. For a **new** issue only, after retaining its URL, run
   `bash <mux-work>/scripts/status.sh <issue-url> "List"`.
   Issue creation and board placement are separate operations. A failure leaves
   that URL with `Board: pending`; retry placement on the same issue, never
   create a replacement. Recovered creations still need their pending placement.
5. When every selection has a URL, recorded context and confirmed required
   new-issue List placement, edit the heading to `Retro capture: complete` and
   clear the remaining steps. Otherwise leave it pending with the precise
   unfinished steps and errors. Report created/reused links (respecting visibility)
   and pending failures to Pedro. Resume with `/mux-work <source-owner/repo#n>`;
   Pick up finishes capture only, even when the source already has a passing brief.
