# Which T3 Code components replace the board's UI

Research for [#264](https://github.com/maddec01/mux-factory/issues/264), part of the #262 map.

T3 Code source read at `pingdotgg/t3code` commit
[`27e0c68`](https://github.com/pingdotgg/t3code/tree/27e0c684c585f955252d65f06206dd11a143bff5)
(main on 2026-10-24). Paths below are relative to `apps/web/` in that tree unless they start
with `board/` or `app/`. The board was read at `f131a78`. T3 Code is MIT, copyright 2026 T3 Tools
Inc. ([LICENSE](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/LICENSE)).

## Summary

- T3's `src/components/ui` covers the board's buttons, badges, dialogs, alert dialog, menu,
  popover, tooltip, banners, form fields and disclosures. It has no card, no progress bar and no
  fieldset. The `@coss` registry that `components.json` names has all three.
- T3's `toast.tsx` can't be copied unchanged: it imports T3's thread routes, composer draft store,
  `MorphIcon` and `@t3tools/contracts`. The coss registry's `toast.tsx` needs only `@base-ui/react`
  and `button`.
- New npm dependencies: `class-variance-authority` and `tailwind-merge`. The board already has
  `@base-ui/react`, `lucide-react`, `react`, `react-dom` and `tailwindcss`.
- The board's tokens already hold T3's light and dark values under shorter names. What's missing is
  T3's `@theme inline` block that turns them into Tailwind colours (`bg-popover`,
  `text-muted-foreground`, `border-input`), the radius scale, `--text-2xs` and the base
  `border-color` rule.
- Copy cost: about 2,100 lines of T3 files (2,450 with a toast) to replace about 150 board lines,
  85 of them CSS. The board adds about 100 lines of glue. Its own code shrinks by roughly 50 lines;
  the rest is vendored.

## Board UI element to T3 file

The app window (`app/src`) has no web UI of its own to replace. `StartingPage.ts` is an inline
`data:` URL page with no bundle, `RestartDialog.ts` is Electron's native message box (as T3's
`dialogs.confirm` is), and `WindowTitleBar.ts` sets window options. Everything below is on the
board page (`board/src/app`, styled by `board/src/styles.css`).

| Board element | Where | T3 file and part |
| --- | --- | --- |
| `.copy` buttons: Add item, Settings, Close, Cancel, Copy, Recheck, Queue, View item, New item | `TitleBar.tsx`, `AddItem.tsx`, `Settings.tsx`, `AbandonDialog.tsx`, `CopyButton.tsx`, `ToolNotices.tsx`, `ItemActions.tsx`, `notices.tsx` | `ui/button.tsx`, `Button variant="outline" size="xs"` (24 px, the size `.copy` already copies) |
| Add to List (`.submit-item`) | `AddItem.tsx` | `ui/button.tsx`, `variant="default"`, default size (32 px) |
| Start (`.start-item`) | `StartControl.tsx` | `ui/button.tsx`, `variant="default" size="xs"` as the menu trigger |
| List row Abandon (`.abandon`) | `ItemActions.tsx` | `ui/button.tsx`, `variant="destructive-outline" size="xs"` |
| Abandon dialog's confirm button | `AbandonDialog.tsx` | `ui/button.tsx`, `variant="destructive"` or `"destructive-outline"` (today's look) |
| Close (×) on toasts, banners and errors (`.dismiss`) | `Toasts.tsx` `DismissButton` | `ui/button.tsx`, `variant="ghost" size="icon-xs"` with lucide `XIcon` |
| Back to List and the footer's Abandon (`.link-action`) | `ItemActions.tsx` | `InlineButton` in `ui/button.tsx`, `tone="muted"` and `tone="destructive"` |
| Update button | `UpdateButton.tsx` | Already a copy of `components/sidebar/SidebarUpdatePill.tsx`; keeps its own classes |
| Update button's tooltip | `UpdateButton.tsx` | `ui/tooltip.tsx`, `Tooltip`, `TooltipTrigger`, `TooltipPopup variant="glass"` (update details) or default |
| Update changelog | `UpdateButton.tsx` | `ui/preview-card.tsx` `PreviewCardPopup`, or `ui/popover.tsx` as T3 now does (see open questions) |
| Start's model menu | `StartControl.tsx` | `ui/menu.tsx`, `Menu`, `MenuTrigger`, `MenuPopup align="end"`, `MenuRadioGroup`, `MenuRadioItem` with `MenuRadioItemIndicator`, `MenuGroup`, `MenuGroupLabel` |
| Add item and Settings dialogs | `AddItem.tsx`, `Settings.tsx` | `ui/dialog.tsx` (`Dialog`, `DialogTrigger`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogPanel`, `DialogFooter`, `DialogClose`) with `ui/dialog-styles.ts` |
| Dialog backdrop (`.dialog-backdrop`) | all three dialogs | `DialogBackdrop` / `AlertDialogBackdrop`, the `dialog-backdrop` utility in `src/index.css` |
| Abandon confirmation | `AbandonDialog.tsx` | `ui/alert-dialog.tsx`, `AlertDialogPopup`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogClose` |
| Slice popover | `SlicePopover.tsx` | `ui/popover.tsx`, `Popover`, `PopoverTrigger`, `PopoverPopup` (it takes `keepMounted`, `anchor`, `side`, `align`, `sideOffset`) |
| Toasts | `Toasts.tsx`, `toast-store.ts`, `update-toasts.tsx`, `notices.tsx` | `ui/toast.tsx` only after edits; coss `toast.tsx` unchanged (see below) |
| Banners: Stale, gh logged out or missing, can't reach the server (`.banner`, `ClosableBanner`) | `Header.tsx`, `ToolNotices.tsx`, `ClosableBanner.tsx` | `ui/alert.tsx`, `Alert variant="warning"` with `AlertTitle`, `AlertDescription`, `AlertAction` holding the close button |
| Form results (`#item-result`, `#settings-result` with `data-tone`) | `AddItem.tsx`, `Settings.tsx` | `ui/alert.tsx`, `variant` warning, success or error, with `role="status"` (props override Alert's `role="alert"`) |
| T3 missing page (`.tool-missing-box`) | `ToolNotices.tsx` | `ui/standalone-page.tsx` (`tone="error"`) or `ui/empty.tsx` |
| Title, description inputs | `AddItem.tsx` | `ui/input.tsx` `Input`, `ui/textarea.tsx` `Textarea` |
| Repository and Kind selects (native) | `AddItem.tsx` | `ui/select.tsx` (Base UI Select); see open questions |
| Field labels | `AddItem.tsx` | `ui/label.tsx` |
| Applicability and profile checkboxes | `AddItem.tsx`, `Settings.tsx` | `ui/checkbox.tsx` (Base UI Checkbox; `name` and `value` keep `FormData.getAll('labels')` working) |
| Update channel radios | `Settings.tsx` | `ui/radio-group.tsx`, `RadioGroup`, `Radio` |
| List platform groups and Done (`<details>`, `Disclosure.tsx`) | `BoardView.tsx` | `ui/collapsible.tsx`, `Collapsible`, `CollapsibleTrigger`, `CollapsiblePanel` |
| Platform, kind and label pills (`.plat`, `.kind`, `.label`) | `item-parts.tsx` | `ui/badge.tsx`, `variant="outline"` with the dot as a child, or `variant="label"` with `--label` set per kind |
| blocked by, sub-issues (`.blocked-by`, `.subs`) | `Card.tsx`, `BoardView.tsx` | `ui/badge.tsx`, `variant="error"` and `variant="outline"` |
| PR checks (`.checks`) | `Card.tsx` | `ui/badge.tsx`, `outline` (running, passed), `error` (failed), `warning` (slow) |
| Started and May have started tags | `StartControl.tsx` | `ui/badge.tsx`, `variant="success"` and `variant="warning"` |
| Header counts (`.totals li`) | `Header.tsx` | `ui/badge.tsx`, `variant="outline" size="control"`, `warning` for "need you" |
| "for T3 Code" pill | `TitleBar.tsx` | `ui/badge.tsx`, `variant="secondary" size="sm"` (the board uses `--accent` because zinc-50 barely shows on zinc-25) |
| Cards (`.card`, `.card.amber`) | `Card.tsx` | None in T3. coss `card.tsx` (254 lines) |
| Concept progress bar | `BoardView.tsx` | None in T3. coss `progress.tsx` (85 lines) |
| Form fieldsets (`.applicability`, `.profiles`, `.update-channel`) | `AddItem.tsx`, `Settings.tsx` | None in T3. coss `fieldset.tsx` (33 lines) |

Native `title` tooltips (stats, checks, blocked by, status segments, sample-mode buttons) could
move to `ui/tooltip.tsx`. That's a behaviour change, so it isn't counted here.

Sources: [`src/components/ui`](https://github.com/pingdotgg/t3code/tree/27e0c684c585f955252d65f06206dd11a143bff5/apps/web/src/components/ui),
[`components.json`](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/apps/web/components.json)
(style `base-mira`, registries `@coss` at `https://coss.com/ui/r/{name}.json` and `@spell`),
[coss card](https://coss.com/ui/r/card.json), [progress](https://coss.com/ui/r/progress.json),
[fieldset](https://coss.com/ui/r/fieldset.json), [toast](https://coss.com/ui/r/toast.json).

### Behaviour the copies don't cover as they stand

- `DialogPopup` renders its own `DialogPortal` without `keepMounted`, so Add item's draft wouldn't
  survive a close. `dialog.tsx` also exports `DialogPortal`, `DialogBackdrop` and `DialogViewport`,
  so Add item can compose them with `keepMounted` and `DIALOG_POPUP_CLASS` without editing the copy.
- `DialogViewport` centres the popup in the window (`grid-rows-[1fr_auto_1fr] p-4`). The board
  opens its dialogs 52 px down, below the title bar. Keeping that needs a `className` on the
  viewport, which the composed form above allows.
- `DIALOG_POPUP_CLASS` sets `[-webkit-app-region:no-drag]` on the popup, but nothing in
  `dialog-styles.ts` sets it on the backdrop. The board's rule for the backdrop has to stay, or a
  click on the backdrop over the title bar drags the window.
- `PreviewCardPopup` passes `align`, `side` and `sideOffset` to its positioner but not `anchor`.
  The update button anchors the changelog on itself through `anchor`, because its trigger is the
  tooltip's. T3 itself has since moved the changelog to a `Popover`
  (`components/sidebar/SidebarUpdatePill.tsx` at 27e0c68 imports `Popover` and `PopoverCreateHandle` from `ui/popover`; the
  board copied it at 9a391eb, when it was a PreviewCard).
- `MenuPopup` wraps the items in its own scroll box; the "Start with" heading becomes a
  `MenuGroupLabel` or stays a `<p>`. `MenuRadioItem` shows no check unless the item adds
  `MenuRadioItemIndicator`.
- Base UI Select renders a button and a hidden input. The Add item form listens for `onInput` on
  the form and calls `form.reportValidity()`; a Select change fires no native `input` event, and
  its `required` check runs through Base UI's Field, not the browser's.

## Dependencies

What the copied files import, from their `import` lines at 27e0c68, and the versions in
[`package.json`](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/apps/web/package.json).

| Package | T3 range | Board (`board/package.json`) | Needed by |
| --- | --- | --- | --- |
| `@base-ui/react` | `^1.4.1` | `^1.4.1`, has it | every primitive, `merge-props`, `use-render` |
| `class-variance-authority` | `^0.7.1` | missing, add | `button`, `badge`, `alert`, `select`, `spinner`, `cn` |
| `tailwind-merge` | `^3.4.0` | missing, add | `cn` in `src/lib/utils.ts` |
| `lucide-react` | `^0.564.0` | `^1.61.0`, has it | `dialog` (`XIcon`), `menu`, `select`, `spinner`, `toast` |
| `react`, `react-dom` | catalog | `19.3.0`, has it | all; `dialog.tsx` uses React 19's `use()` and `<Context value>` |
| `tailwindcss`, `@tailwindcss/vite` | `^4.0.0` | `4.3.3`, has it | the class names |
| `lucide`, `morphicons`, `effect`, `@t3tools/contracts`, `@t3tools/shared` | | none | only T3's `toast.tsx` and `lib/utils.ts`; not needed if those two aren't copied |

The board's `lucide-react` is a major version ahead of T3's. The icons the copies use (`XIcon`,
`CheckIcon`, `ChevronDownIcon`, `ChevronUpIcon`, `ChevronRightIcon`, `SearchIcon`,
`LoaderCircleIcon`) need a build to confirm they still exist under those names; the board already
imports `CheckIcon` from 1.61.

Internal imports the copies make:

- `~/lib/utils` (`cn`). T3's `src/lib/utils.ts` (50 lines) imports `@t3tools/contracts`,
  `effect/encoding/Hex` and `composerDraftStore`, so the board writes its own: `cn` from cva's
  `cx` and `extendTailwindMerge` registering `text-2xs` to `text-5xs`, about 10 lines. coss's
  `utils` does the same with `clsx` instead of `cx`.
- `~/lib/visibleAnimation` (64 lines, no imports), for `spinner.tsx`, which `menu.tsx` imports.
- `~/lib/windowControlsOverlay` (102 lines), for `tooltip.tsx`'s `useNativeTitlebarHeight`. It
  imports `~/env` (5 lines, reads `window.desktopBridge`). The board copies both, or shims `~/env`.
- `~/components/ui/scroll-area` (102 lines), for `DialogPanel`.
- `menu.tsx` imports `input.tsx` and `spinner.tsx` for its search field, so they come along.

Module setup: T3's web app uses `"moduleResolution": "Bundler"`, `"verbatimModuleSyntax": false`
and the path `~/*` to `./src/*`
([`tsconfig.json`](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/apps/web/tsconfig.json)).
The board's `tsconfig.json` uses `nodenext` with `verbatimModuleSyntax: true` and `.ts` import
extensions, so the copies' extensionless `./button` and `~/...` imports fail its typecheck. Keeping
the copies unchanged needs a `~` alias in `vite.config.ts` and a Bundler-resolution tsconfig for
the copied folder.

## Token mapping

`board/src/styles.css` already copies T3's `:root` values and their dark variant from
`src/index.css` (it cites 0bdf33a; the values are the same at 27e0c68). The names differ.

| Board | T3 variable | Tailwind colour the copies use | Light value (both) |
| --- | --- | --- | --- |
| `--bg` | `--background` | `background` | zinc-25 |
| `--fg` | `--foreground` | `foreground` (via `--contrast-foreground`) | zinc-800 |
| `--surface` | `--card`, `--popover` | `card`, `popover` | white |
| `--muted` | `--muted-foreground` | `muted-foreground` | zinc-500 |
| `--muted-bg` | `--muted`, `--secondary` | `muted`, `secondary` | zinc-50 |
| `--accent` | `--accent` | `accent` | zinc-100 |
| `--bd` | `--border` | `border` | zinc-200 |
| `--input` | `--input` | `input` | zinc-300 |
| `--primary`, `--primary-fg` | `--primary`, `--primary-foreground` | `primary`, `primary-foreground` | `oklch(0.488 0.217 264)`, white |
| `--focus` | `--ring` | `ring` | primary |
| `--warning`, `--warning-fg`, `--warning-surface` | `--warning`, `--warning-foreground`, `--warning-surface` | same | amber-500, amber-700, 8% mix |
| `--error`, `--error-fg`, `--error-surface` | `--error` and `--destructive`, `--error-foreground` and `--destructive-foreground`, `--error-surface` | `error`, `destructive`, `destructive-foreground` | red-500, red-700, 8% mix |
| `--success`, `--success-fg` | `--success`, `--success-foreground` | same | emerald-500, emerald-700 |
| `--info-fg` | `--info-foreground` | `info-foreground` | blue-700 |
| `--r`, `--r-control`, `--r-sm` | `--radius`, `--control-radius`, `--radius-sm` | `rounded-*` | 0.625rem, 0.5rem |
| `--shadow` | `--shadow-composer` (`-dark` in dark) | | |
| `--glass-blur`, `--glass-opacity`, `--glass-saturation` | same names | | 12px, 80%, 1.14 (dark 16px, 1.08) |
| `--update-icon` | `--sidebar-icon-color` | | |
| `--update-surface` | `--sidebar-control-surface` (light) | | name clash, see below |

The dark values match line for line: neutral-950 page, card and popover at 97% page with 3% white,
white at 3%, 4%, 6% and 8% for muted, accent, border and input, `oklch(0.571 0.21 264)` primary,
red-400, amber-400, emerald-400 and blue-400 foregrounds, 16% error and warning surfaces.

What the board must add before the copies render:

- An `@theme inline` block mapping `--color-background`, `--color-foreground`,
  `--color-popover`, `--color-popover-foreground`, `--color-card`, `--color-card-foreground`,
  `--color-muted`, `--color-muted-foreground`, `--color-secondary`,
  `--color-secondary-foreground`, `--color-accent`, `--color-accent-foreground`,
  `--color-border`, `--color-input`, `--color-ring`, `--color-primary`,
  `--color-primary-foreground`, `--color-destructive`, `--color-destructive-foreground`,
  `--color-error*`, `--color-warning*`, `--color-success*`, `--color-info*`,
  `--color-placeholder` and `--color-icon-muted`. T3 routes several through `--contrast-*`, which
  equal the plain token while `--appearance-contrast-base` is 100% and the boost 0%, so the board
  can map straight to the plain token.
- Tokens the board lacks: `--accent-foreground` (zinc-900, dark neutral-100),
  `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--placeholder`, `--info`
  (blue-500) and `--color-zinc-25` (`oklch(99.2% 0 0)`).
- `--radius-sm` to `--radius-2xl` (`calc(var(--radius) - 4px)` up to `+ 8px`), and `--text-2xs`
  to `--text-5xs`.
- T3's base rule `* { @apply border-border outline-ring/50; }`. The copies use a bare `border`
  class and rely on it; Tailwind 4's preflight defaults borders to `currentColor`.
- `@source "./components/ui";`, since `styles.css` uses `source(none)` and lists its sources.
- The `dialog-glass` and `dialog-backdrop` utilities, copied from `src/index.css` (28 lines):
  - `dialog-glass` is the page colour at `--glass-opacity` with the glass blur and saturation, a
    border of 10% foreground (8% white in dark) and a `0 24px 64px -24px` shadow (dark adds a 4%
    white inset line and a deeper shadow), falling back to `--popover` without backdrop-filter.
  - `dialog-backdrop` is the page colour at 60% (64% in dark) with `blur(4px)`. The board's
    current `.dialog-backdrop` is plain `rgb(0 0 0 / 40%)`. The class name is the same, so the
    board's rule has to go or it overrides T3's.
- `dropdown-glass` and `visible-animate-spin` are already in `styles.css`. `dropdown-glass` must
  switch from `--surface` and `--fg` to `--popover` and `--contrast-foreground` (or `--foreground`).

Dark mode: T3 declares `@custom-variant dark (&:is(.dark, .dark *))` and sets `.dark` from its
theme setting. The board follows `prefers-color-scheme`, which is Tailwind 4's default `dark`
variant, so the copies' `dark:` classes and `@variant dark` blocks work there with no class
toggling. The board's dark `:root` override becomes the place to add the missing dark tokens.

`--update-surface` clashes. T3 uses it for the update colour's tint (`--update` at 12%, 18% in
dark) and maps it to `--color-update-surface`; the board uses it for the update button's zinc-100
pill. Rename the board's before adding T3's colour map.

## Board styles with no T3 equivalent

These stay in `board/src/styles.css` whichever components are copied:

- Cards: `.card`, the amber stripe `.card.amber`, `.meta`, `.title`, `.parent`, `.foot`,
  `.card-stats`, `.card-actions` and the `margin-top: auto` footer rule. coss has `card.tsx`.
- The status and slice bars: `.bars`, `.segbar`, `.steps` colours, `.slice-bar` with its pulse,
  `.bar-label`, `.slices-now`.
- The concept progress bar (`.progress`) and sub-issue groups. coss has `progress.tsx`.
- The coloured dot on platform, kind, label and checks badges (`::before` with `--k`) and the kind
  colours. T3's badge has no dot; its `label` variant tints the whole badge from `--label`.
- Sections and their headings, the counts strip layout, `.empty` dashed boxes.
- Row lists: `.rows`, `.row-item` hover, `.row-title` truncation and the `.labels` fade mask.
- The slice popover's rows and marks, and the hover bridges (`::before`) under the slice popover
  and the changelog.
- The changelog's typography (`.update-notes` headings, lists, separators).
- Fieldsets and legends in the forms. coss has `fieldset.tsx`.
- The board's own roles: `--you*`, `--thread`, `--sub`, `--sub-text`, `--build`, `--danger-text`,
  `--line`, `--soft`, `--update-hover`.
- Title bar layout and brand mark, toast placement below the header (`--toast-top`), the
  `-webkit-app-region: no-drag` rules, the anchor flash and the reduced-motion rules.

## Copy cost

Line counts from `wc -l` on each file at 27e0c68.

| File | Lines | For |
| --- | ---: | --- |
| `ui/button.tsx` | 131 | buttons, `InlineButton` |
| `ui/badge.tsx` | 60 | badges |
| `ui/dialog.tsx` | 225 | Add item, Settings |
| `ui/dialog-styles.ts` | 22 | dialog and alert dialog classes |
| `ui/scroll-area.tsx` | 102 | `DialogPanel` |
| `ui/alert-dialog.tsx` | 150 | Abandon |
| `ui/alert.tsx` | 149 | banners, form results |
| `ui/menu.tsx` | 395 | Start's menu |
| `ui/input.tsx` | 80 | title field, menu search |
| `ui/spinner.tsx` | 40 | menu |
| `lib/visibleAnimation.ts` | 64 | spinner |
| `ui/popover.tsx` | 149 | slice popover |
| `ui/tooltip.tsx` | 165 | update tooltip |
| `lib/windowControlsOverlay.ts` + `env.ts` | 107 | tooltip |
| `ui/preview-card.tsx` | 44 | changelog (or none if it moves to the popover) |
| `ui/textarea.tsx` | 43 | description |
| `ui/label.tsx` | 22 | labels |
| `ui/checkbox.tsx` | 60 | ticks |
| `ui/radio-group.tsx` | 35 | update channel |
| `ui/collapsible.tsx` | 43 | List groups, Done |
| Core total | 2,086 | |
| coss `toast.tsx` | 332 | toasts, if chosen |
| `ui/select.tsx` | 217 | selects, if chosen |
| `ui/standalone-page.tsx` | 69 | T3 missing page, if chosen |
| T3 `ui/toast.tsx` + `toast.logic.ts` + `toastHelpers.ts` | 945 | not copyable unchanged |

Board lines the core set replaces, from `board/src/styles.css`:

| Group | CSS lines |
| --- | ---: |
| Buttons (`.copy`, `.submit-item`, `.start-item`, `.abandon`, `.dismiss`, `.link-action`, disabled) | 18 |
| Dialogs, headings, form results | 17 |
| Inputs, textarea, select, ticks | 6 |
| Toasts | 10 |
| Start menu | 9 |
| Popover and changelog boxes | 4 |
| Badge boxes (dots stay) | 13 |
| Banners | 3 |
| `details.platform` | 5 |
| Total | 85 |

In TSX, `Toasts.tsx` (92) and `toast-store.ts` (39) lose their timer and list code to Base UI's
toast manager, about 50 to 70 lines. The pause-on-hover and failure-stays rules are Base UI
options; moving focus to `focusAfter` after a close isn't, so that part stays. The other
components keep their logic and swap class names for components, so their length barely changes.

Glue the board adds: about 80 lines of CSS (colour map, radius and text scale, base border rule,
two utilities), a 10-line `lib/utils.ts`, a Vite alias and a tsconfig for the copied folder.

Net: about 2,100 vendored lines (2,450 with coss's toast), for about 150 board lines removed and
100 added. Like `skills/`, the vendored files would need an upstream record so a later sync can
diff them against T3.

## Open questions for Pedro

1. Toasts. T3's `toast.tsx` needs edits to drop its thread routing, composer draft store,
   `MorphIcon` and `@t3tools/contracts`. Take coss's `toast.tsx` unchanged, copy T3's and edit it,
   or keep the board's toasts with T3's classes?
2. Dialog placement. T3 centres dialogs in the window over a blurred backdrop. Should the board
   take that, or keep them opening below the 52 px title bar?
3. Unchanged copies. They need a `~` alias, a Bundler-resolution tsconfig for the folder, and the
   board's own `lib/utils.ts` and `env.ts`. Is that preferable to editing the copies' imports?
4. Selects. Base UI Select breaks the Add item form's `onInput` and `reportValidity()` flow. Keep
   the native selects with T3's look, or move the form to controlled state?
5. Cards, progress bar and fieldsets. Take coss's `card.tsx`, `progress.tsx` and `fieldset.tsx`,
   or keep the board's CSS?
6. Changelog. Follow T3's move to a Popover, or keep the PreviewCard the board copied at 9a391eb?
7. Token names. Rename the board's tokens to T3's (`--bg` to `--background` and so on, about 150
   references), or alias T3's names to the board's?
