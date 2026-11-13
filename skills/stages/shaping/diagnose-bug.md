Ported from mattpocock/skills (skills/engineering/diagnosing-bugs); see UPSTREAM.md.

# Diagnose bugs

Input: confirmed failing behavior and repository. Output: cause, evidence,
open questions and a failing regression test to write. Stop before fixing the
product. Read relevant glossary/ADRs. Skip phases only with explicit reasons.

Redact every secret as `<REDACTED>` before showing commands or artifacts.
Keep credentials in environment variables and quote only diagnostic lines,
especially from captures containing auth headers. If redaction removes evidence
needed for diagnosis, ask the user. Follow orchestration's heavy-command rules.

## 1. Build a feedback loop

Spend the effort needed to obtain a fast, deterministic pass/fail command for
the exact symptom. Try, roughly in order: a failing test at the relevant seam;
an HTTP script; a CLI fixture/snapshot; a browser assertion; captured-trace
replay; an isolated throwaway harness; property/fuzz cases; automated bisection;
a differential old/new run; lastly a human-driven structured script using
`scripts/hitl-loop.template.sh`.

Narrow setup and scope, assert the symptom rather than absence of a crash, and
pin time, randomness, filesystem and network. For nondeterminism, repeat the
trigger, add stress or alter timing to establish a pinned, high reproduction
rate. A rare flake is not enough.

Before forming a theory, name one command already run, with redacted invocation
and output, that exercises the actual bug path, can detect this symptom, runs
in seconds and is agent-runnable. Human steps require the structured script.
Without this loop, stop and list attempts; request the reproducing environment,
a redacted capture or permission for temporary production instrumentation.

## 2. Reproduce and minimise

Run the loop red repeatedly, confirming the user's exact failure, not a nearby
bug. Record the error, wrong output or timing. For flaky bugs, establish a rate
high enough to diagnose. Remove inputs, callers, configuration, data and steps
one at a time, rerunning after each removal. Finish only when removing any
remaining element makes the loop green. Do not advance before reproduction
and minimisation.

## 3. Hypothesise

Rank 3–5 hypotheses before testing any. Each predicts what specific change
would remove or worsen the failure. Discard or sharpen unfalsifiable claims.
Show the ranked list before testing so the user can correct it; proceed with
the ranking if they are absent.

## 4. Instrument

Map each probe to a prediction and change one variable at a time. Prefer a
debugger/REPL, then targeted logs at distinguishing points, never indiscriminate
logging. Give every debug log a unique prefix for cleanup. Performance
regressions need a baseline measurement/profiler/query plan, then bisection,
rather than speculative logging.

Return the diagnosis within 300 words. Keep logs and captures in the child's
context; the owner saves the accepted evidence and open questions in the brief
or decision answer. Do not implement the fix.
