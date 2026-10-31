# Issue tracker: GitHub

This repository's tickets are its GitHub issues. Lar Factory reads them with
the `gh` CLI and the local login, which infers the repository from
`git remote -v` inside a clone. The factory's own progress lives in work
records on the user's machine, so no step writes it to an issue.

## Reading issues

- Read an issue: `gh issue view <number> --comments`.
- List open issues: `gh issue list --state open --json number,title,labels`.

## Work records

Work reaches the board when the user captures it there or picks an issue there.
Each piece of work has one record, named by its work ID, which holds its Status,
structure, brief, map, decisions, slices and PR. A picked issue's text at pick
time is the record's initial context. Refinement in the record is the
authority, and later issue edits never change it.

Resolve a thread's argument, a work ID or an issue, with the lar skill's
`shared/scripts/work.sh <ref>`. For an issue no record holds, it says to pick
the issue on the board first. The lar skill's
`shared/issue-tracker/work-records.md` covers picking, Status, structure and
completion.

A build delivers one standalone PR and needs no issue. Its recorded PR merging
makes it Done.

## When a skill says "publish to the issue tracker"

Offer optional publication once refinement finishes, and later on request,
through the lar skill's `shared/issue-tracker/publication.md`. Use `lar-work`
and its journal with the board open or closed. Show exact text, destination,
mapped team terms and operations for approval. Recheck before writes, resume
recorded outcomes and reconcile uncertainty before an approved retry or fallback.
Decisions and slices stay private. Publication, Ready and Start build are
separate choices. Provider edits never rewrite private refinement.

A build's PR uses its own published ticket's GitHub closing reference even
when the repository sets no link style, per `shared/issue-tracker/publication-pr.md`.
Keep the project's other PR rules and a complete outcome, decisions and reasons
for ticketless PRs. Local Done follows the recorded PR merging.

## When a skill says "fetch the relevant ticket"

Resolve the work with `shared/scripts/work.sh <ref>`, then read the record's
initial context as `shared/issue-tracker/work-records.md` shows. For a picked
issue, `gh issue view <number> --comments` shows its current text.
