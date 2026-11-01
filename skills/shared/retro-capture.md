# Retro capture

Use after the builder's retro selection. Capture selected work as List records
on this machine; shaping and implementation come later. Ordinary captures create
tickets when the destination's retro setting is on, as it is by default.
Verified Access and the session-wide Azure read-only setting still apply.
A concept follows the saved structural-sync option. Keep the source build's final Status throughout,
including clarification questions and failures.

## Select and route

1. Resolve replies against the numbered list per [Retro picks](questions.md#retro-picks).
   Capture only the user's explicit picks; “all” selects the whole list. Clarify
   ambiguous, conflicting or partly unclear replies in chat before capturing
   anything, even when other picks are clear. Wait for clarification;
   uncertainty or silence never means “none”. An explicit “none”, or no
   suggestions, ends capture with nothing made. With no suggestions, ask no
   selection question.
2. Route each selected suggestion to the repository owning its product code,
   instructions, CI or local tooling. Factory workflow or board changes belong
   to the factory repository when it is onboarded. Keep an unowned machine-wide suggestion in chat until the user
   chooses its repository. One suggestion needing changes across repositories
   becomes one concept in the source work's repository per [Capture-only concepts](issue-tracker/capture-only-concepts.md).
   A destination must be on the board: `repo-config.sh --list` lists the
   onboarded repositories. Report a pick whose repository isn't, and suggest
   onboarding it.

## Capture

Keep a stable UUID for each pick's local capture and another for its ticket
submission in this thread. Reuse them and the original capture text on reruns.
These request IDs belong in command arguments, separate from the description.

For each selection, in order:

1. Reuse an unfinished record that already covers the suggestion, keeping its
   Status. Tell the user which one, so they add the new context when shaping
   it. For a rerun, use the work ID already reported for this pick.
2. Otherwise make one record:
   `lar-work create --request-id <capture-uuid> --title "<actionable title>" --repository <repo> --kind <bug|feature|improvement> --status List --file <context>`.
   The context holds the selected improvement and useful context, without work
   IDs or selection IDs. Capture text is not a passing brief. Repeating this
   command with the same request ID and text returns the same record.
3. For an ordinary record made for this pick, read its revision and run
   `lar-work create-ticket <work-id> --revision <revision> --request-id <ticket-uuid> --retro`.
   The command obeys the destination's retro setting. With it on, it creates a
   ticket using only the kind's mapped labels and type, then attaches it to the
   same record. With it off, the record stays local. Concept captures follow
   [Capture-only concepts](issue-tracker/capture-only-concepts.md) instead.

Report each made or reused record's title and work ID, its ticket when created,
and each failed pick with its error. A failed ticket create leaves its record
local for conversion from item details. Report Access refusals and provider
errors without changing the source build's final Status. A saved failure stays
with its submission; rerunning uses the saved IDs and reports that outcome. An uncertain create only searches for its existing result and
never creates another ticket. Follow its error when the result cannot be found.
