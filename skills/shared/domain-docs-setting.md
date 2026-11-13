Ported from mattpocock/skills (skills/engineering/domain-modeling/SKILL.md); see UPSTREAM.md.

# Domain-doc setting

`repo-config.sh <repository>` reads this machine's local `domainDocs` setting.
This setting controls drafting and file writes. `off` is OFF and `repository`
is ON. A saved `private` value reads as OFF, never as a private drafting mode.
No repository instructions or setup files are required.

`{"kind": "repository", "glossary": "GLOSSARY.md", "adrs": "docs/adr"}`
names the glossary file and ADR folder. Use the configured paths in place of the
examples below. Builds include the relevant entries and ADRs in their build PR.

`{"kind": "off"}` means write no domain drafts or glossary or ADR files. Read
existing domain docs for context and write "none" in the brief's or map's Domain
docs and a decision's domain-drafts body. Offer no later publication. When ON,
shaping drafts entries in work records, the whole gated brief includes them in
the ticket Spec when enabled, and the builder writes them in the build PR.
Shaping alone writes no repository files in either mode.
