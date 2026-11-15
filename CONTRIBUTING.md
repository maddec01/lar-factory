# Contributing

## Develop

Node 24.15+ and pnpm, from the repository root:

```bash
pnpm install
pnpm run dev      # open the board app
pnpm test
cd apps/desktop && pnpm run build --unsigned   # unsigned Apple Silicon app in apps/desktop/release/
```

App data lives in `~/Library/Application Support/Lar Factory/` (or an absolute `LAR_FACTORY_DATA_DIR`);
`LAR_FACTORY_AZURE_READ_ONLY=1` bars Azure writes.

## Release

The Release workflow signs and notarizes with the maintainer's Developer ID. Before the
first Release, and whenever the certificate or API key changes, run
`bash scripts/release-secrets.sh` (needs `gh` logged in as a repo admin; `--dry-run` to preview).

Start a Release from Actions > Release > Run workflow on main. `nightly` builds main's head
once CI passed for that commit; `stable` rebuilds the latest Nightly's commit as `v<version>`.
To ship a stable: bump `version` in `apps/desktop/package.json` and merge, start a Nightly
and wait for it to publish, then start a Stable Release. Runs queue one at a time and GitHub
keeps only the newest waiting run; rerun one that shows as canceled.
