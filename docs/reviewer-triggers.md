# Reviewer triggers, version 1

Run `lar-work select-reviewers ID --base SHA --head SHA` in the build checkout.
Both arguments must be full commit SHAs. For whole-branch review, pass the
merge base with the target branch as base and the pinned HEAD as head. This
compares those two trees directly; it does not include uncommitted files or
compute a different merge base. `--data-dir D` selects local saved settings and
the work-record database, as for other lar-work commands.

The result identifies the work ID, checkout, commits and trigger version, and
contains every reviewer, sorted by stable ID. Each has `run`, `reason`, `mode`,
`outcome`, `rule`, `evidence` and its selected instructions. `never` wins even
when the diff is uncertain. `always` needs no match. Code defaults to always;
Security, UI and Performance default to their named version-1 policies.
Doubt and approver are separate stages and are unaffected. Selection prints a
result; it does not launch reviewers, persist a run snapshot or change review
history. The builder records skipped reasons through its existing round flow.

Named policies match case-insensitive path and code signals (UI text signals
are case-sensitive). Security covers input, auth, sessions, permissions,
filesystem operations, uploads, shell scripts, dependencies, lockfiles, CI,
secrets and networking. UI covers web, components, styles, assets, localization,
native layouts and UI symbols. Performance covers rendering, polling, queries,
data loops, bundles and dependency manifests. Exact signals live in
`packages/work-records/src/reviewer-rules.ts`; changes to their interpretation
require a new trigger version rather than silently changing version 1.

These are lexical signals, not semantic proof. Complete recognized text formats
with no policy signal skip that policy; ordinary arithmetic does not become an
uncertain match merely because it is source code. Recognized formats are the
fixed extension list in `recognizedText` (common source, styles, markup, data,
configuration and documentation). Unknown formats or unavailable content run
otherwise-unmatched policies with `unclassified-impact`. Empty diffs skip
conditional policies. Names and example code in docs can positively match;
small loops and nonvisual web services can run reviewers a human would skip.
Conversely, indirect effects through opaque wrappers or runtime content in
unrecognizable locations can be missed. Saved custom rules or always mode can
cover those project-specific cases.

Custom `rules.any` is an OR in saved rule order:

- `path-glob` matches the whole repository-relative path, case-sensitively.
  `*` and `?` match within one segment; a standalone `**` segment matches zero
  or more segments. Dotfiles are ordinary names. Patterns are at most 512
  characters. Absolute paths, backslashes, brackets, braces, parentheses,
  negation and embedded `**` are unsupported and produce uncertainty.
- `diff-text` is a case-sensitive literal substring, not a regex. It searches
  removed and added lines in diff order, with diff markers removed and newlines
  between them. Unchanged context, filenames and hunk headers do not match.

Files are evaluated in lexical path order, with a path signal before a text
signal. A definite match wins over uncertainty. Otherwise any uncertainty runs;
only a complete negative result skips. Evidence identifies the matched rule and
path (and changed-line ordinal for built-in text matches), without copying
source text or credentials into the result.

Renames are evaluated as deletion plus addition so both paths are checked.
External diff tools, text conversion, rename heuristics and working-tree binary
attributes cannot change selection. Binary/NUL content, invalid UTF-8,
submodule pointers, permission-mode changes, symlinks and files exceeding the 16 MiB/30 second Git read limits
have unknown text. Incomplete path enumeration is explicitly uncertain. Missing
or invalid commits fail the command; they never silently become an empty diff.
Custom path-only rules can still skip a binary file whose known path does not
match. The pure `selectReviewers(settings, diff)` function is exported from
`@lar-factory/work-records/reviewer-selection` for callers with the same inputs.
