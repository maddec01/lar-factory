import { Tooltip as NinnaTooltip, type TooltipContentProps, type TooltipTriggerProps } from '@ninna-ui/overlays';
import { Slot, TooltipEngine } from '@ninna-ui/react-internal';
import { type ComponentProps, forwardRef, isValidElement } from 'react';

// eslint-disable-next-line react-refresh/only-export-components -- Reuse the shared engine provider directly.
export const TooltipProvider = TooltipEngine.Provider;

export function Tooltip({ disabled, ...props }: ComponentProps<typeof TooltipEngine.Root> & { disabled?: boolean }) {
    return <TooltipEngine.Root {...props} open={disabled ? false : props.open} />;
}

export const TooltipTrigger = forwardRef<HTMLButtonElement, TooltipTriggerProps>(
    ({ asChild, children, ...props }, ref) => {
        const childProps = asChild && isValidElement<TooltipTriggerProps>(children) ? children.props : undefined;

        if (props.disabled || childProps?.disabled) {
            const Trigger = asChild ? Slot : 'button';

            return (
                <NinnaTooltip.Trigger asChild>
                    <span
                        tabIndex={0}
                        role="button"
                        aria-disabled="true"
                        aria-label={props['aria-label'] ?? childProps?.['aria-label']}
                        aria-labelledby={props['aria-labelledby'] ?? childProps?.['aria-labelledby']}
                        className="inline-flex [&>*]:pointer-events-none"
                    >
                        <Trigger type="button" {...props} ref={ref}>
                            {children}
                        </Trigger>
                    </span>
                </NinnaTooltip.Trigger>
            );
        }

        return (
            <NinnaTooltip.Trigger {...props} ref={ref} asChild={asChild}>
                {children}
            </NinnaTooltip.Trigger>
        );
    },
);

TooltipTrigger.displayName = 'TooltipTrigger';

export const TooltipPopup = forwardRef<HTMLDivElement, Omit<TooltipContentProps, 'color' | 'hasArrow'>>(
    (props, ref) => (
        // Radix supplies the tooltip role on its visually hidden accessible description.
        <NinnaTooltip.Content {...props} ref={ref} role={undefined} />
    ),
);

TooltipPopup.displayName = 'TooltipPopup';
