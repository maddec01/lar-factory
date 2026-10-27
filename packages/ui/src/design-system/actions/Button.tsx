import { Button as NinnaButton, type ButtonProps as NinnaButtonProps } from '@ninna-ui/primitives';
import { forwardRef } from 'react';

import { tabbable } from '../foundations/KeyboardFocus';

/** T3 Code's button (coss ui): an 8px-radius control, 36px on touch and 32px with a pointer, that dips to
 *  97% while pressed. Every recipe sets its own colours, so ninna-ui only supplies behaviour. */
const base =
    'h-9 gap-2 rounded-md border px-[11px] text-sm font-medium whitespace-nowrap transition-[background-color,box-shadow,scale,color] duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary focus-visible:ring-offset-0 disabled:opacity-64 sm:h-8 [&_[data-slot=icon]>svg]:size-4';

const outline =
    'border-base-400/90 bg-base-100 text-base-content shadow-xs/5 hover:bg-base-200/70 dark:border-base-400 dark:bg-base-400/30 dark:hover:bg-base-400/60 [&_[data-slot=icon]]:text-base-700';
const ghost =
    'border-transparent text-base-content hover:bg-base-200 data-[state=open]:bg-base-200 [&_[data-slot=icon]]:text-base-700';

const recipes = {
    primary:
        'border-primary bg-primary text-primary-content shadow-xs shadow-primary/24 inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-primary/90 active:shadow-none active:inset-shadow-[0_1px_rgb(0_0_0/8%)]',
    secondary: outline,
    quiet: ghost,
    row: `${ghost} h-auto min-h-8 min-w-0 max-w-full justify-start whitespace-normal px-0 py-1 text-left text-xs font-normal text-base-700 hover:bg-transparent hover:text-base-content sm:h-auto active:scale-100`,
    subtle: 'border-transparent bg-base-200 text-base-content hover:bg-base-300/70 dark:bg-base-300 dark:hover:bg-base-400',
    destructive:
        'border-danger bg-danger text-white shadow-xs shadow-danger/24 inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-danger/90 active:shadow-none',
    'destructive-quiet':
        'border-transparent text-(--lar-danger-text) hover:bg-danger/8 dark:hover:bg-danger/16 [&_[data-slot=icon]]:text-current',
    choice: outline,
    context: `${ghost} h-11 min-w-0 gap-1.5 px-2 lg:max-w-48 lg:pointer-fine:h-8`,
    summary: `${ghost} h-8 min-w-0 px-1.5 sm:h-8`,
    avatar: 'h-auto rounded-full border-transparent p-0 hover:bg-transparent sm:h-auto',
    status: 'h-4 min-w-0 max-w-full justify-start gap-1.5 rounded-sm border-transparent px-0 text-xs font-normal text-base-700 hover:bg-transparent hover:text-base-content sm:h-4 active:scale-100 [&>svg]:size-3 [&>svg]:shrink-0',
} as const;

const selectedChoice =
    'border-primary/60 bg-primary/8 text-base-content ring-1 ring-inset ring-primary/40 hover:bg-primary/12 dark:border-primary/60 dark:bg-primary/16 dark:hover:bg-primary/20';

export type ButtonProps = Omit<NinnaButtonProps, 'color' | 'radius' | 'size' | 'variant'> & {
    variant?: keyof typeof recipes;
    selected?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'primary', selected, className = '', children, leftIcon, rightIcon, ...props }, ref) => {
        const context = variant === 'context';

        return (
            <NinnaButton
                ref={ref}
                {...tabbable}
                {...props}
                size="sm"
                radius="lg"
                variant="ghost"
                color="neutral"
                aria-pressed={selected ?? props['aria-pressed']}
                className={`${base} ${variant === 'choice' && selected ? selectedChoice : recipes[variant]} ${selected && variant !== 'choice' ? 'bg-base-200' : ''} ${className}`}
                leftIcon={
                    context ? <span className="text-(--color-header-icon) [&>svg]:size-4">{leftIcon}</span> : leftIcon
                }
                rightIcon={context ? <span className="text-base-700 [&>svg]:size-3.5">{rightIcon}</span> : rightIcon}
            >
                {context ? <span className="truncate">{children}</span> : children}
            </NinnaButton>
        );
    },
);

Button.displayName = 'Button';
