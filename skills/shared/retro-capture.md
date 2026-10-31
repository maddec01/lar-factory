# Retro capture

Use after the builder's retro selection. Capture selected work as List records
on this machine; shaping and implementation come later. Capture writes no
ticket. Keep the source build's final Status throughout, including
clarification questions and failures.

## Select and route

1. Resolve replies against the numbered list per [Retro picks](questions.md#retro-picks).
   Capture only the user's explicit picks; “all” selects the whole list. Clarify
   ambiguous, conflicting or partly unclear replies in chat before capturing
   anything, even when other picks are clear. Wait for clarification;
   uncertainty or silence never means “none”. An explicit “none”, or no
   suggestions, ends capture with nothing made. With no suggestions, ask no
   selection question.
2. Route each selected suggestion to the repository that owns the change: its
   product code, `AGENTS.md`, CI or local tooling → that repository; the
   factory workflow or board, shared skills and instructions, and machine-wide
   setup without a clear owner → the factory repository,
   `maddec01/lar-factory`. One suggestion needing changes across repositories →
   one factory concept per [Capture-only concepts](issue-tracker/capture-only-concepts.md).
   A destination must be on the board: `repo-config.sh --list` lists the
   onboarded repositories. Report a pick whose repository isn't, and suggest
   onboarding it.

## Capture

Generate an opaque batch ID once (a UUID, say), then a stable selection ID per
pick (`retro-capture:<batch-id>:<index>`). Reuse these exact IDs on reruns;
never regenerate them from rewritten suggestion text.

For each selection, in order:

1. Look for a record that already holds it: the destination's records
   (`lar-work list --repository <repo>`) whose initial context
   (`lar-work context`) carries the exact selection ID. A rerun after a failure
   finds what the first run made this way.
2. Reuse an unfinished record that already covers the suggestion, keeping its
   Status. Tell the user which one, so they add the new context when shaping
   it.
3. Otherwise make one record:
   `lar-work create --title "<actionable title>" --repository <repo> --kind <bug|feature|improvement> --status List --file <context>`.
   The context holds the selected improvement, useful context, the source
   build's work ID and the exact selection ID. Capture text is not a passing
   brief.

Report each made or reused record's title and work ID, and each pick that
failed with its error. Rerun capture in the same thread for the failed picks;
step 1 keeps a rerun from making a second record.
