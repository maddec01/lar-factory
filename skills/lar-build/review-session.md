Ported from mattpocock/skills, `skills/engineering/retro/SKILL.md`. See [UPSTREAM.md](../../UPSTREAM.md) for the Ports record.

Review the build for useful follow-ups: product work deliberately left out of
scope, deferred reviewer findings, and improvements to future agent runs.

## Steps

1. Read `<lar-build>/shared/write-agent-docs.md` only when drafting an agent-facing
   document or an exact replacement instruction; ordinary suggestions use prose rules.

2. Read the current approved brief, including **Excluded**, the source ticket
   including its **Original** text, the recorded review rounds and their
   dispositions/reasons, the PR's out-of-scope notes, and the build session.
   Use the amended brief when scope changed. Check existing work records and
   linked tickets before proposing something already tracked.

3. Look for candidates for improvement in these categories.

- **Deferred product work**: scope the Spec or ticket defers ("for now", "later", "only X", "not yet") becomes a suggestion by default, including **Excluded** items those words refer to. For example, "Only German for now" with **Excluded: Adding any other languages** yields "Support additional greeting languages", with the next languages left for shaping. Explain the user benefit and cite the deferral; exclusion from this delivery is not evidence of permanent rejection. Omit deferred work only when already delivered or tracked, or explicitly a permanent non-goal ("never", "won't do"). A boundary with no deferral evidence remains a candidate only when there is a concrete user benefit.
- **Deferred reviewer findings**: propose actionable findings left out of this delivery, preserving the reviewer's evidence and the reason for deferral. Skip fixed findings and rejected false positives. Never defer a requirement or delivery blocker through Retro.
- **Navigation**: how easy was it for the agent to find the right files? Are there hidden dependencies between files? Would a **navigation pointer** make it easier? _Use when_ the session took a long time to find a piece of information.
- **Automated checks**: are there automated checks that could catch errors the agent made? Linting, typing, tests, filesystem linters? Read the repo's own check command first (its `package.json`/build-tool `lint`/`check` scripts, its CI workflow), so a check that already exists but sits unwired or silently broken is the finding, not a reinvention. A repo with no **guardrail** (no pre-commit hook and no CI job running its lint/typecheck/test command) is itself a finding: an un-linted repo is a standing missed opportunity, not a neutral default. _Use when_ the agent made a mistake an automated check could have caught, or the repo has no guardrail at all.
- **Coding standards**: should the **reviewer agent** be given a new rule to enforce? Should an existing rule be removed or clarified? Classify the violation first: a **mechanical** one (a fixed syntactic pattern, a banned API, an import shape, a file-location rule) gets a deterministic check, full stop: a custom rule in the repo's own linter, a new pre-commit hook, or a new CI job, whichever the repo's language and existing guardrail make cheapest. Default to building the check over writing the rule. Reserve existing project standards for genuine **judgement calls** (cross-file consistency, "matches the surrounding style," anything no guardrail could ever substitute for). _Use when_ the reviewer agent failed to catch a mistake.
- **Global AGENTS.md**: are there any steering instructions that should be moved to coding standards (or automated checks) instead? _Use when_ the AGENTS.md file is particularly large - in the repo OR the user's global scope.
- **Tool economy**: did the agent make expensive tool calls that could be streamlined? Is there any custom tooling (CLI's, MCP's) that is particularly token-inefficient? _Use when_ the agent made an expensive tool call.
- **No-ops**: look for instructions in steering files that don't modify the agent's behavior. _Use when_ the steering files are large and unwieldy.
- **Information access**: look for opportunities to increase the agent's access to information. Teeing dev server logs, readonly access to third-party services. _Use when_ a crucial piece of information was not available to the agent.

4. Keep distinct, actionable candidates with a source, expected benefit and
   reason they belong in later work. Include that evidence in each description;
   combine duplicates and omit work already delivered or tracked. Propose the
   remaining candidates through the build's Retro stage, in order of severity.
   Save `[]` only after checking these sources and finding no remaining candidate.
   In the handback, name any omitted deferred scope and cite its delivered work,
   existing record/ticket or explicit permanent rejection; "still excluded" is
   not a reason to omit deferred scope. There is no suggestion quota.

## Boundaries

Suggest product follow-ups or changes to existing conventions or factory skills; the factory never
creates or offers repository configuration or agent guidance files. Implementation
belongs to a later explicitly selected follow-up. Keep concrete navigation,
automation, judgement, tool economy and information-access findings; remove
instructions only when evidence shows they change no required behavior.
