# Releases carry their own skills and checklists

The board app installs the `skills/` and `references/` folders bundled in its Release on the first launch of each new version. It doesn't run the skills CLI or read main. The installed skills then always match the app, and a teammate needs no Node or npx.

## Considered options

Running `npx skills add` at the Release's tag was rejected because it needs Node on every Mac.
