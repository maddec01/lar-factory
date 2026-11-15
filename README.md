<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/lar-factory-on-dark.png">
    <img alt="Lar Factory" src=".github/assets/lar-factory-on-light.png" height="56">
  </picture>
</p>

# Lar Factory

A local software factory for any repository. Shape issues and ideas, keep the
work on a board, and build chosen changes through review to a PR. You decide
what to build and merge every PR.

## Get started

Install the Mac app from [GitHub Releases](https://github.com/maddec01/lar-factory/releases)
and open it with [T3 Code](https://github.com/pingdotgg/t3code) running. In Settings > Projects,
choose Add project:

1. Project. Choose a T3 project for the repository you want to work with.
2. Access. Check what your local login can read and write.
3. Work and docs. Choose the issue source, issue defaults, domain docs and optional kind
   mappings. GitHub uses repository issues; Azure DevOps uses a team's backlog and current sprint.
4. Done. Review the setup and add the Project.

The app uses your local `gh` or `az` login and keeps its data in
`~/Library/Application Support/Lar Factory/` (or an absolute `LAR_FACTORY_DATA_DIR`).
`LAR_FACTORY_AZURE_READ_ONLY=1` bars Azure writes. Repositories need no factory files.
The app installs the `lar-shape` and `lar-build` skills and the `~/.local/bin/lar-work`
command; `lar-work --help` lists its commands.

## Develop

Node 24.15+ and pnpm, from the repository root:

```bash
pnpm install
pnpm run dev      # open the board app
pnpm test
cd apps/desktop && pnpm run build --unsigned   # unsigned Apple Silicon app in apps/desktop/release/
```

## Release

The Release workflow signs and notarizes with the maintainer's Developer ID. Before the
first Release, and whenever the certificate or API key changes, run
`bash scripts/release-secrets.sh` (needs `gh` logged in as a repo admin; `--dry-run` to preview).

Start a Release from Actions > Release > Run workflow on main. `nightly` builds main's head
once CI passed for that commit; `stable` rebuilds the latest Nightly's commit as `v<version>`.
To ship a stable: bump `version` in `apps/desktop/package.json` and merge, start a Nightly
and wait for it to publish, then start a Stable Release. Runs queue one at a time and GitHub
keeps only the newest waiting run; rerun one that shows as canceled.

## Credits and licence

MIT, see [LICENSE](LICENSE). The copied skills and code come from:

- [Matt Pocock](https://github.com/mattpocock/skills): most of the copied skills.
- [Addy Osmani](https://github.com/addyosmani/agent-skills): the review and hardening checklists bundled inside `lar-build`.
- [Lauren Tan](https://github.com/cursor/plugins/tree/main/pstack): `unslop`, from `pstack` in cursor/plugins.
- [T3 Tools](https://github.com/pingdotgg/t3code): T3 Code's desktop app, ported into the board app.
- [coss](https://github.com/cosscom/ui): the registry T3's base components derive from.

All five are MIT; their notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and
[UPSTREAM.md](UPSTREAM.md) records each Copy and Port. The factory idea draws on ZazenCodes'
[Build Your Own AI Software Factory](https://www.youtube.com/watch?v=ctoaIC4LHmI).
