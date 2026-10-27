import { Alert as NinnaAlert, type AlertProps as NinnaAlertProps } from '@ninna-ui/feedback';

import type { StatusTone } from './StatusIndicator';

type AlertProps = Omit<NinnaAlertProps, 'color' | 'size' | 'variant'> & {
    compact?: boolean;
    /** Stays below the application header while its containing region is visible. */
    sticky?: boolean;
    tone?: Exclude<StatusTone, 'neutral'>;
};

/**
 * An immediate status about a condition or operation. Compact notes can hold short inline guidance.
 * Use NoticeCard for content that needs examination and InfoBox for guidance that opens another surface.
 */
export function Alert({ compact = false, sticky = false, tone = 'info', className = '', ...props }: AlertProps) {
    return (
        <NinnaAlert
            size={compact ? 'xs' : 'sm'}
            showIcon
            {...props}
            color={tone}
            className={
                (sticky ? 'sticky top-(--lar-header-height,0px) z-30 bg-base-50 shadow-sm ' : '') +
                (compact
                    ? '[&_[data-slot=title]]:text-xs [&_[data-slot=description]]:text-xs [&_[data-slot=icon]>svg]:size-4 '
                    : '') +
                className
            }
        />
    );
}
