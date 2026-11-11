import type { ButtonProps } from '@lar-works/design-system';

/**
 * Footer rule: the stage's next action is the single Main button at the right. Starts in a dialog use Main;
 * compact starts on board rows use Start. GitHub and Open thread stay Open unless they perform the next action
 * (Answer in T3, Verify build or Merge PR). Completed work has no next action and needs no Main button.
 * Lar Factory's five kinds of button. A Main action, at most one per area, is filled; a Start is tinted, with the play
 * icon: it launches agent work (Shape, Start build, Start after), and its split half chooses the model/options; a desk
 * card's next step (Answer in T3, Verify build, Review failed checks) is a Next, tinted too, as the thing you can do
 * now.
 * Tint never means selected or running. An Open is outlined, with the thread or pull request icon; an App control
 * has no border and an icon (also used for quiet icon-only thread links in concept parts lists); any Other
 * button is outlined, with no icon. A dialog or a form is an area of its own, so its submit is its Main action. Every
 * kind keeps its look while disabled.
 */
export type ButtonKind = 'main' | 'start' | 'next' | 'open' | 'control' | 'other';

/**
 * A button's height comes from the surface it sits on, never from its kind (the design system's density policy):
 * `sm` (28px) in the title bar, toolbars, a row's or a card's actions and a section header's action; `md` (32px) in
 * forms, settings rows, every dialog's footer and empty states. Both use the 13px control label.
 */
export type ButtonDensity = 'sm' | 'md';

export const recipe = {
    main: 'primary',
    start: 'tinted',
    next: 'tinted',
    open: 'secondary',
    control: 'quiet',
    other: 'secondary',
} as const satisfies Record<ButtonKind, ButtonProps['variant']>;

/** The danger recipe of the two kinds that may destroy: a Main confirm is filled, any Other destructive choice is the
 *  quiet-destructive ghost (docs/Introduction.mdx). */
export const dangerRecipe = { main: 'destructive', other: 'destructive-quiet' } as const;

/** The kinds that may destroy. */
export type DangerKind = keyof typeof dangerRecipe;

/** A kind's props at a size: its recipe (or its danger recipe), the size and `data-kind`. */
export interface KindProps<K extends ButtonKind, V> {
    variant: V;
    size: ButtonDensity;
    'data-kind': K;
}

/** How a kind is drawn where it sits: its surface's size, and for a destructive Main or Other its danger tone. */
interface ButtonKindOptions {
    /** The danger recipe: a filled destructive confirm (Main) or the quiet-destructive ghost (Other). */
    tone?: 'danger' | undefined;
    /** The surface's density: `sm` (the default) on bars, rows, cards and section headers; `md` in forms, settings
     *  rows, dialog footers and empty states. */
    size?: ButtonDensity;
}

/**
 * Props to spread on the design system's Button for a kind: its recipe, its surface's size and `data-kind`, which
 * names the kind for tests and the board's sheets. The second argument is the danger tone (`'danger'`) or the
 * options: `buttonKind('main', { size: 'md' })` for a dialog's footer, `buttonKind('main', { tone:
 * 'danger', size: 'md' })` for a destructive confirm. A destructive confirm, such as Reset or Abandon in its
 * confirmation, is its area's Main action filled in the danger colour; a destructive choice beside others, such as a
 * notice's Abandon, which asks in its confirmation first, is an Other in the quiet-destructive ghost.
 */
export function buttonKind<K extends ButtonKind>(
    kind: K,
    options?: { size?: ButtonDensity },
): KindProps<K, (typeof recipe)[K]>;
export function buttonKind<K extends DangerKind>(
    kind: K,
    options: 'danger' | { tone: 'danger'; size?: ButtonDensity },
): KindProps<K, (typeof dangerRecipe)[K]>;
export function buttonKind<K extends DangerKind>(
    kind: K,
    options: 'danger' | undefined | ButtonKindOptions,
): KindProps<K, (typeof recipe)[K] | (typeof dangerRecipe)[K]>;
export function buttonKind(kind: ButtonKind, options?: 'danger' | ButtonKindOptions) {
    const { tone, size = 'sm' } = typeof options === 'object' ? options : { tone: options };

    return {
        variant: tone ? dangerRecipe[kind as DangerKind] : recipe[kind],
        size,
        'data-kind': kind,
    };
}
