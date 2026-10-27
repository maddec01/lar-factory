import { Field as NinnaField, type FieldProps as NinnaFieldProps } from '@ninna-ui/forms';
import { forwardRef } from 'react';

import { formControlDefaults } from './FormControlStyles';

export type FieldProps = Omit<NinnaFieldProps, 'size'>;

export const Field = forwardRef<HTMLDivElement, FieldProps>(({ className, ...props }, ref) => (
    <NinnaField
        ref={ref}
        {...props}
        size={formControlDefaults.size}
        className={`[&>div:first-child>label>span]:text-base-500 [&>p]:text-xs ${className ?? ''}`}
    />
));

Field.displayName = 'Field';
