# Upstream

The copy record: every Copy in this package, where it came from, and the upstream
commit it matches byte for byte. A Copy is never edited here; an update is a fresh
copy from upstream and a diff, with its row's commit moved on. The build adapts to
the Copies instead (`docs/adr/0016-copy-t3s-base-components-unchanged.md`).

| File | Source | Path | Commit |
| ---- | ------ | ---- | ------ |
| `src/components/ui/alert.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/alert.tsx` | `d53873b6a479` |
| `src/components/ui/alert-dialog.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/alert-dialog.tsx` | `d53873b6a479` |
| `src/components/ui/badge.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/badge.tsx` | `d53873b6a479` |
| `src/components/ui/button.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/button.tsx` | `d53873b6a479` |
| `src/components/ui/checkbox.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/checkbox.tsx` | `d53873b6a479` |
| `src/components/ui/dialog-styles.ts` | pingdotgg/t3code | `apps/web/src/components/ui/dialog-styles.ts` | `d53873b6a479` |
| `src/components/ui/dialog.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/dialog.tsx` | `d53873b6a479` |
| `src/components/ui/input.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/input.tsx` | `d53873b6a479` |
| `src/components/ui/label.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/label.tsx` | `d53873b6a479` |
| `src/components/ui/radio-group.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/radio-group.tsx` | `d53873b6a479` |
| `src/components/ui/scroll-area.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/scroll-area.tsx` | `d53873b6a479` |
| `src/components/ui/textarea.tsx` | pingdotgg/t3code | `apps/web/src/components/ui/textarea.tsx` | `d53873b6a479` |

Full commits: pingdotgg/t3code `d53873b6a4799e87afd63c8d288ef0089f5a3748`.

Licences: pingdotgg/t3code is MIT, in `licenses/t3code.txt`.

The board writes its own versions of what the Copies import from T3's app:
`src/lib/utils.ts` (`cn`). `src/styles.css` holds T3's tokens and the styles
the Copies' class names need, written by the board from T3's
`apps/web/src/index.css`.
