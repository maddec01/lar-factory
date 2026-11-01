# Standalone factory design

Lar Factory works with any repository. Repository onboarding saves local choices
for source, domain docs, structure sync, issue defaults, optional vocabulary
mappings and verified Access. It requires no
setup PR, repository configuration or agent guidance files. Existing project
instructions apply when present; package scripts, CI and neighboring code supply
conventions and checks otherwise.

The app and `lar-work` share local work records. They hold queue, Status, briefs,
decisions, slices, threads and build progress. Shaping produces refinement without
committing to implementation. Starting a build is a later user choice.

One local domain-doc setting controls drafting and file writes. OFF creates no
drafts and sets Domain docs to "none". A saved private value reads as OFF.
Repository is ON, drafts entries during shaping, includes them in enabled ticket
Specs, and writes glossary entries and ADRs in the build PR.

Tracker sync is ON by default during onboarding and saves only concept and
multi-repository structure. It saves kind, map diagram, parts, Connections,
Dependencies and issue grouping, with the shaping results needed to explain
them. An automatic structural outbox handles local structural edits.
`lar-work sync-structure <work ID>` requests a drain. Queue, board Status,
per-item progress, decision records and slices stay local. Separate ON-by-default
settings create issues from Add item and retro captures and write whole gated
briefs as ticket Specs, preserving earlier text as Original. Once synced, the
ticket is the source of truth and the record keeps a copy. Later gates and builds
reread it; a failed read uses the last copy with a warning. The Spec outbox keeps
failed writes pending without blocking Ready. Verified Access and the Azure
read-only session setting control writes for any repository.

A fresh installation adds saved concepts or multi-repository work from List and
restores kind, map, parts and relationships. Queue and Status start fresh. Tracker
sync is not work-record backup. See [the README](../README.md) for the user flow
and [skill layout](skill-layout.md) for workflow packaging.
