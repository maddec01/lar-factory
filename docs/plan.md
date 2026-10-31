# Standalone factory design

Lar Factory works with any repository. Repository onboarding saves local choices
in three steps, repository, source/docs/sync, then access/add. It requires no
setup PR, repository configuration or agent guidance files. Existing project
instructions apply when present; package scripts, CI and neighboring code supply
conventions and checks otherwise.

The app and `lar-work` share local work records. They hold queue, Status, briefs,
decisions, slices, threads and build progress. Shaping produces refinement without
committing to implementation. Starting a build is a later user choice.

One local domain-doc setting controls writes. Private is OFF, with no build doc
writes or later publish prompts. Repository is ON and includes glossary entries
and ADRs in the build PR.

Tracker sync is ON by default during onboarding and saves only concept and
multi-repository structure. It saves kind, map diagram, parts, Connections,
Dependencies and issue grouping, with the shaping results needed to explain
them. An automatic structural outbox handles local structural edits.
`lar-work sync-structure <work ID>` requests a drain. No queue, board Status,
per-item progress or ordinary brief, decision or slice reaches the tracker.

A fresh installation adds saved concepts or multi-repository work from List and
restores kind, map, parts and relationships. Queue and Status start fresh. Tracker
sync is not work-record backup. See [the README](../README.md) for the user flow
and [skill layout](skill-layout.md) for workflow packaging.
