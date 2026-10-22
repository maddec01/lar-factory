# Retro capture

Use after the builder's retro selection, or when Pick up finds an unfinished
capture record. Capture selected work as issues; shaping and implementation
come later. Keep the source issue's final status throughout, including
clarification questions and failures. On resume, reuse the existing plan and IDs.

## Select and route

1. Resolve replies against the numbered list per [Retro picks](questions.md#retro-picks).
   Capture only Pedro's explicit picks; “all” selects the whole list. Clarify
   ambiguous, conflicting or partly unclear replies in chat before creating
   or updating any destination issue, even when other picks are clear. Wait
   for clarification; uncertainty or silence never means “none”. An explicit
   “none”, or no suggestions, completes the no-picks path: post a one-line
   `Retro capture: complete — no picks` on the source issue and finish without
   follow-ups. With no suggestions, ask no selection question.
2. Route each selected suggestion to `maddec01/`:
   - Server work → `mux-server`; Apple work → `mux-apple`.
   - A repository's own `AGENTS.md`, CI or local tooling → that repository.
   - Factory workflow/board, shared/global skills and instructions → `mux-factory`.
   - Global environment, machine-wide tooling/configuration and information
     access without a clear repository owner → `mux-factory`.
   - One suggestion needing changes across repositories → one `mux-factory`
     concept listing the affected repositories; prefer a matching open concept.
3. Before drafting titles, bodies, context comments or the source record, read
   the destination's issue conventions and visibility/redaction rules.
   `mux-factory` is public; `mux-server` and `mux-apple` are private. Every
   public surface, a Factory source record included, stays public-safe: no
   private logs, credentials, private hostnames, or sensitive paths or details.
   Source links, and destinations/URLs that expose private work, appear only
   where safe for the audience; identifying provenance and any needed private
   mapping live in an access-appropriate private record, linked only where
   safe. Public destinations reached from private work get opaque capture IDs
   that encode no private repository names, issue numbers or details.

## Persist the plan

Before creating issues or posting destination context, successfully post one
source-issue comment headed `Retro capture: pending`, in place of the generic
answers comment. Generate an opaque batch ID once (a UUID, say), then a stable
selection ID per pick (`retro-capture:<batch-id>:<index>`). Reuse these exact
IDs on retries; never regenerate them from rewritten suggestion text.

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
before destination mutations. When redaction needs a private companion record,
persist it before mutation too, and keep both records' progress consistent.

## Capture and reconcile

Run these steps in order for each selection, updating its record as each
succeeds. Persist every returned URL before the next mutation. If a record
update fails, stop and report the pending step; on resume, reconcile rather
than repeat a possibly successful mutation.

1. Use the record's retained URL first. Without one, reconcile the destination
   against the exact selection ID in issue bodies and comments, then clearly
   matching **open issues in that destination repository**, inspecting each
   candidate: search results alone prove neither absence nor a match. This
   capture may have created an issue whose URL never reached the record;
   recover it by its marker before creating anything. If the outcome can't be
   established, leave it pending and report the uncertainty. A recovered
   creation stays **new** for board placement and a recovered reuse stays
   **reused**; continue its unfinished steps as such.
2. Reuse a clearly matching open issue (a concept for cross-repository work).
   Add the new source/context with the selection ID, first checking existing
   comments for that exact ID; on retry, an existing marked comment counts as
   recorded. Keep the issue's status; call no `status.sh` for reuse.
3. Otherwise create one issue with an actionable title, the selected
   improvement, useful context, safe provenance and the exact selection ID in
   its body. First follow [label setup](issue-tracker.md#label-setup) for the
   **destination** repository, including `mux-factory` for a cross-repository
   concept captured from another Mux repository. Do this after persisting the
   source plan; if setup fails, leave capture pending and retry setup before
   creating the issue. Follow destination label conventions (`bug`, `feature`,
   `improvement` as fits); capture text is not a passing brief. A
   cross-repository concept gets the `concept` label and the sections in
   [Concepts](concepts.md): Destination (with affected repositories), Decisions
   so far (confirmed choices only), Fog (unshaped decomposition), Out of scope,
   Map (no sub-issues yet). Capture creates no decisions or sub-issues and
   starts no shaping or build.
4. For a **new** issue only, after retaining its URL, run
   `bash <mux-work>/scripts/status.sh <issue-url> "List"`. Creation and board
   placement are separate: a failure leaves that URL with `Board: pending`;
   retry placement on the same issue, never create a replacement. Recovered
   creations still need their pending placement.
5. When every selection has a URL, recorded context and, for new issues,
   confirmed List placement, edit the heading to `Retro capture: complete` and
   clear the remaining steps. Otherwise leave it pending with the exact
   unfinished steps and errors. Report created/reused links (respecting
   visibility) and pending failures to Pedro. Resume with
   `/mux-work <source-owner/repo#n>`; Pick up finishes capture only, even when
   the source already has a passing brief.
