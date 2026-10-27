import {
    RadioGroup as NinnaRadioGroup,
    RadioGroupItem as NinnaRadioGroupItem,
    type RadioGroupItemProps,
    type RadioGroupProps,
    useFormControl,
} from '@ninna-ui/forms';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { formChoiceClasses, formControlDefaults } from './FormControlStyles';

export type { RadioGroupItemProps, RadioGroupProps } from '@ninna-ui/forms';

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>((props, ref) => {
    const groupRef = useRef<HTMLDivElement>(null);
    const formControl = useFormControl();

    useImperativeHandle(ref, () => groupRef.current!);
    // Ninna drops the group's ARIA props instead of forwarding them to its root.
    useLayoutEffect(() => {
        const attributes = {
            'aria-label': props['aria-label'],
            'aria-labelledby': props['aria-labelledby'] ?? (props['aria-label'] ? undefined : formControl?.labelId),
            'aria-describedby': props['aria-describedby'] ?? formControl?.messageId,
        };

        for (const [name, value] of Object.entries(attributes)) {
            if (value === undefined) groupRef.current?.removeAttribute(name);
            else groupRef.current?.setAttribute(name, value);
        }
    });

    return (
        <NinnaRadioGroup ref={groupRef} size={formControlDefaults.size} color={formControlDefaults.color} {...props} />
    );
});

RadioGroup.displayName = 'RadioGroup';

export const RadioGroupItem = forwardRef<HTMLButtonElement, RadioGroupItemProps>(({ className, ...props }, ref) => (
    <NinnaRadioGroupItem
        ref={ref}
        {...props}
        className={`${formChoiceClasses} cursor-pointer focus-visible:ring-offset-0 ${className ?? ''}`}
    />
));

RadioGroupItem.displayName = 'RadioGroupItem';
