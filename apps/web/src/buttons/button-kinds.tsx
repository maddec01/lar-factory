// The board's five kinds of button. A call site names a kind, never a recipe of the copied Button: a Main action, at
// most one per area, is filled; a Start is tinted, with the play icon; an Open is outlined, with the thread or pull
// request icon; an App control has no border and an icon; any Other button is outlined, with no icon. Each kind keeps
// its look while disabled. Its button carries `data-kind`, which button-kinds.css sizes to 28 px and tints for a Start,
// so no Copy in packages/ui changes.

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

/** Spread on the copied Button: the recipe the kind draws over, and the mark its sheet styles. */
export const kind = <K extends ButtonKind>(k: K) => ({ variant: RECIPE[k], 'data-kind': k });

/** Each kind's icons: Start's play, and an Open's thread or pull request. */
export const ICON = {
  play: <Play />,
  thread: <MessageSquareText />,
  pr: <GitPullRequest />,
};
