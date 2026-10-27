// A link drawn as the design system's Button, for an action that opens a page: GitHub, a pull request or a T3
// thread. The copied Button renders only a <button>, so these classes repeat its base and its primary and secondary
// recipes from packages/ui/src/design-system/actions/Button.tsx; keep them in step when that Copy changes.

import type { AnchorHTMLAttributes, ReactNode } from 'react';

const base =
  'relative isolate inline-flex h-9 items-center justify-center gap-2 rounded-md border px-[11px] text-sm font-medium whitespace-nowrap transition-[background-color,box-shadow,scale,color] duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary focus-visible:outline-none sm:h-8 [&_[data-slot=icon]>svg]:size-4';

const recipes = {
  primary:
    'border-primary bg-primary text-primary-content shadow-xs shadow-primary/24 inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-primary/90 active:shadow-none active:inset-shadow-[0_1px_rgb(0_0_0/8%)]',
  secondary:
    'border-base-400/90 bg-base-100 text-base-content shadow-xs/5 hover:bg-base-200/70 dark:border-base-400 dark:bg-base-400/30 dark:hover:bg-base-400/60 [&_[data-slot=icon]]:text-base-700',
} as const;

export type LinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
  href: string;
  variant?: keyof typeof recipes;
  leftIcon?: ReactNode;
};

export function LinkButton({ variant = 'primary', leftIcon, children, ...props }: LinkButtonProps) {
  return (
    <a {...props} data-slot="button" className={`${base} ${recipes[variant]}`}>
      {leftIcon && <span data-slot="icon">{leftIcon}</span>}
      {children}
    </a>
  );
}
