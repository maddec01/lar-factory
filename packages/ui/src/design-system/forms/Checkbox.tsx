import { forwardRef, type InputHTMLAttributes, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { tabbable } from '../foundations/KeyboardFocus';
import { CheckIcon } from '../icons/NavigationIcons';
import { formChoiceClasses } from './FormControlStyles';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    label?: string;
    indeterminate?: boolean;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
    ({ label, indeterminate = false, 'aria-checked': ariaChecked, className, onChange, ...props }, ref) => {
        const inputRef = useRef<HTMLInputElement>(null);

        useImperativeHandle(ref, () => inputRef.current!);
        useLayoutEffect(() => {
            if (inputRef.current) inputRef.current.indeterminate = indeterminate;
        });

        const control = (
            <span className="relative inline-flex size-4 shrink-0 align-middle">
                <input
                    {...tabbable}
                    {...props}
                    ref={inputRef}
                    type="checkbox"
                    onChange={(event) => {
                        onChange?.(event);
                        event.currentTarget.indeterminate = indeterminate;
                    }}
                    aria-checked={indeterminate ? 'mixed' : ariaChecked}
                    className={`peer m-0 size-4 shrink-0 cursor-pointer appearance-none rounded-sm ${formChoiceClasses} checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary dark:checked:border-primary dark:checked:bg-primary dark:indeterminate:border-primary dark:indeterminate:bg-primary forced-colors:appearance-auto ${className ?? ''}`}
                />
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 hidden text-primary-content peer-checked:block peer-indeterminate:hidden peer-disabled:opacity-50 forced-colors:hidden"
                >
                    <CheckIcon />
                </span>
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 hidden items-center justify-center peer-indeterminate:flex peer-disabled:opacity-50 forced-colors:hidden"
                >
                    <span className="h-0.5 w-2 rounded-full bg-primary-content" />
                </span>
            </span>
        );

        return label === undefined ? (
            control
        ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-base-content has-disabled:cursor-default has-disabled:text-base-700">
                {control}
                <span>{label}</span>
            </label>
        );
    },
);

Checkbox.displayName = 'Checkbox';
