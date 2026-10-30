## 3. Brief

Replace the issue body with the brief; the user's original text goes in a
collapsed `<details>` block at the end.

```markdown
## What
<the change, in the user's domain language>

## Done when
- <observable result a reviewer can check>

## Confirmed
- <each assumption the user confirmed, and each decision with a link>

## Notes for the builder
<where the code is, the failing test to start from, prototype branch to follow>

## Domain docs
- Glossary: <each term to add or change, as a GLOSSARY-FORMAT.md entry>, or "none"
- ADRs: <each ADR to write, as an ADR-FORMAT.md draft>, or "none"

## Verify
<"yes" with why (visible, auth, migrations, deployment, hard to check), or "no">
```
