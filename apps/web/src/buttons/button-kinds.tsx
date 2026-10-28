// The board's five kinds of button. A call site names a kind, never a recipe of the copied Button: a Main action, at
// most one per area, is filled; a Start is tinted, with the play icon; an Open is outlined, with the thread or pull
// request icon; an App control has no border and an icon; any Other button is outlined, with no icon. A dialog or a
// form is an area of its own, so its submit is its Main action. Each kind keeps its look while disabled. Its button
// carries `data-kind`, which button-kinds.css sizes to 28 px and tints for a Start, so no Copy in packages/ui changes.
// The sheet reads three marks a call site adds: `data-icon-only` makes a button 28 px square, its icon 20 px when the
// mark is "large"; `data-tint` gives an App control Start's tint, as Update has; and `data-toggle` keeps a toggle at
// its own size, off the kinds' 28 px.

import { GitPullRequest, MessageSquareText, Play } from 'lucide-react';
import type { ButtonProps } from '@lar-factory/ui/design-system/Button';

export type ButtonKind = 'main' | 'start' | 'open' | 'control' | 'other';

const RECIPE = {
  main: 'primary',
  start: 'quiet',
  open: 'secondary',
  control: 'quiet',
  other: 'secondary',
} as const satisfies Record<ButtonKind, ButtonProps['variant']>;

/** Spread on the copied Button: the recipe the kind draws over, and the mark its sheet styles. A destructive confirm,
 *  such as Reset or Abandon, is its area's Main action filled in the danger colour. */
export const kind = <K extends ButtonKind, T extends (K extends 'main' ? 'danger' : never) | undefined = undefined>(k: K, tone?: T) => ({
  variant: (tone ? 'destructive' : RECIPE[k]) as T extends 'danger' ? 'destructive' : (typeof RECIPE)[K],
  'data-kind': k,
});

/** Each kind's icons: Start's play, and an Open's thread or pull request. */
export const ICON = {
  play: <Play />,
  thread: <MessageSquareText />,
  pr: <GitPullRequest />,
};
