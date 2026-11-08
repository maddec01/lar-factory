// The model menu's opening focus: the checked entry receives focus without scrolling.

/** Focus the checked model on open. The design system's menu forwards this Radix prop but omits it from its type. */
export const opensOnChecked = {
    onOpenAutoFocus: (event: Event): void => {
        event.preventDefault();
        (event.target as HTMLElement).querySelector<HTMLElement>('[data-opens-here]')?.focus({ preventScroll: true });
    },
};
