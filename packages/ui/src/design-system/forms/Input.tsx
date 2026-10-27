import { Input as NinnaInput, type InputProps as NinnaInputProps } from '@ninna-ui/forms';
import { forwardRef } from 'react';

import { formControlClasses, formControlDefaults } from './FormControlStyles';

export type InputProps = Omit<NinnaInputProps, 'fullWidth'>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ size = formControlDefaults.size, variant = formControlDefaults.variant, className, ...props }, ref) => (
        <NinnaInput
            ref={ref}
            color={formControlDefaults.color}
            {...props}
            fullWidth
            size={size}
            variant={variant}
            className={`${variant === 'filled' ? formControlClasses : ''} ${className ?? ''}`}
        />
    ),
);

Input.displayName = 'Input';
