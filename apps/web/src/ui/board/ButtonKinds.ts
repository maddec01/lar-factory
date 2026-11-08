import type { ButtonProps } from '@lar-works/design-system';

/**
 * Footer rule: the stage's next action is the single Main button at the right. Starts in a dialog use Main;
 * compact starts on board rows use Start. GitHub and Open thread stay Open unless they perform the next action
 * (Answer in T3, Verify build or Merge PR). Completed work has no next action and needs no Main button.
 * Lar Factory's five kinds of button. A Main action, at most one per area, is filled; a Start is tinted, with the play
 * icon: it launches agent work (Shape, Start build, Start after), and its split half chooses the model/options.
 * Tint never means selected or running. An Open is outlined, with the thread or pull request icon; an App control
 * has no border and an icon (also used for quiet icon-only thread links in concept parts lists); any Other
 * button is outlined, with no icon. A dialog or a form is an area of its own, so its submit is its Main action. Every
 * kind is the `sm` 28px Button and keeps its look while disabled.
 */
export type ButtonKind = 'main' | 'start' | 'open' | 'control' | 'other';

const recipe = {
    main: 'primary',
    start: 'tinted',
    open: 'secondary',
    control: 'quiet',
    other: 'secondary',
} as const satisfies Record<ButtonKind, ButtonProps['variant']>;

/** The danger recipe of the two kinds that may destroy: a Main confirm is filled, any Other destructive choice is the
 *  quiet-destructive ghost (docs/Introduction.mdx). */
const dangerRecipe = { main: 'destructive', other: 'destructive-quiet' } as const;

/** Props to spread on the design system's Button for a kind: its recipe, the `sm` size, and `data-kind`, which
 *  names the kind for tests and the board's sheets. A destructive confirm, such as Reset or Abandon in its
 *  confirmation, is its area's Main action filled in the danger colour (`buttonKind('main', 'danger')`); a
 *  destructive choice beside others, such as a notice's Abandon, which asks in its confirmation first, is an Other
 *  in the quiet-destructive ghost (`buttonKind('other', 'danger')`). */
export const buttonKind = <
    K extends ButtonKind,
    T extends (K extends keyof typeof dangerRecipe ? 'danger' : never) | undefined = undefined,
>(
    kind: K,
    tone?: T,
) => ({
    variant: (tone ? dangerRecipe[kind as keyof typeof dangerRecipe] : recipe[kind]) as T extends 'danger'
        ? (typeof dangerRecipe)[K & keyof typeof dangerRecipe]
        : (typeof recipe)[K],
    size: 'sm' as const,
    'data-kind': kind,
});
