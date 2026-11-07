# Upstream

The copy record: every Copy in this package, where it came from, and the upstream
commit it matches byte for byte. A Copy is never edited here; an update is a fresh
copy from upstream and a diff, with its row's commit moved on. The build adapts to
the Copies instead.

| File | Source | Path | Commit |
| ---- | ------ | ---- | ------ |
| `src/search-dialog/useModalAutoFocus.ts` | maddec01/lar-web | `packages/design-system/src/overlays/useModalAutoFocus.ts` | `4a059bd2547a` |
| `src/search-dialog/useScrollFade.ts` | maddec01/lar-web | `packages/design-system/src/overlays/useScrollFade.ts` | `4a059bd2547a` |

Full commit: maddec01/lar-web `4a059bd2547a997b8394acdfbd4406391951d69e`.

The board's components, tokens and styles come from `@lar-works/design-system`, lar-web's
`packages/design-system`, which the apps and this package depend on. The Copies are the two hooks its overlays
use without exporting them, which the search dialog needs. lar-web is lar's own, under the MIT licence.
