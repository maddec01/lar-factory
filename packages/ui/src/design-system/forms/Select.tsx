import {
    Select as NinnaSelect,
    SelectItem as NinnaSelectItem,
    type SelectItemProps,
    type SelectProps as NinnaSelectProps,
} from '@ninna-ui/forms';
import { forwardRef } from 'react';

import { tabbable } from '../foundations/KeyboardFocus';
import { formControlClasses, formControlDefaults } from './FormControlStyles';

export type SelectProps = Omit<NinnaSelectProps, 'fullWidth'>;

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
    ({ size = formControlDefaults.size, variant = formControlDefaults.variant, className, ...props }, ref) => (
        <NinnaSelect
            ref={ref}
            color={formControlDefaults.color}
            {...tabbable}
            {...props}
            fullWidth
            size={size}
            variant={variant}
            className={`${variant === 'filled' ? formControlClasses : ''} [&>span:first-child]:truncate ${className ?? ''}`}
        />
    ),
);

Select.displayName = 'Select';

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(({ icon, children, ...props }, ref) => (
    <NinnaSelectItem ref={ref} {...props}>
        {icon ? (
            <span className="inline-flex min-w-0 items-center gap-2 align-middle">
                <span aria-hidden="true" className="size-4 shrink-0 [&>svg]:size-full">
                    {icon}
                </span>
                <span className="truncate">{children}</span>
            </span>
        ) : (
            children
        )}
    </NinnaSelectItem>
));

SelectItem.displayName = 'SelectItem';
