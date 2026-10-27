import { Textarea as NinnaTextarea, type TextareaProps } from '@ninna-ui/forms';
import { forwardRef } from 'react';

import { formControlClasses, formControlDefaults } from './FormControlStyles';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
    <NinnaTextarea
        ref={ref}
        {...formControlDefaults}
        {...props}
        className={`${formControlClasses} ${className ?? ''}`}
    />
));
Textarea.displayName = 'Textarea';
