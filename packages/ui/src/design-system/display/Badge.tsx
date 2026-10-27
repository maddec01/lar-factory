import { Badge as NinnaBadge, type BadgeProps as NinnaBadgeProps } from '@ninna-ui/primitives';
import type { CSSProperties } from 'react';

import type { StatusTone } from '../feedback/StatusIndicator';

export type BadgeProps = Omit<NinnaBadgeProps, 'color' | 'size' | 'variant'> & {
    tone?: StatusTone | 'accent';
    /** A lar-brand app hue that colours the badge in place of its tone. */
    hue?: number;
};

/** T3 Code's badge: a 6px-radius label on an 8% tint of its tone, in the tone's foreground colour. */
const toneClasses: Record<NonNullable<BadgeProps['tone']>, string> = {
    neutral: 'bg-base-200 text-base-800 dark:bg-base-300 dark:text-base-800',
    accent: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-[color-mix(in_srgb,var(--color-primary)_55%,white)]',
    success: 'bg-success/10 text-(--lar-success-text) dark:bg-success/16',
    warning: 'bg-warning/12 text-(--lar-warning-text) dark:bg-warning/16',
    danger: 'bg-danger/10 text-(--lar-danger-text) dark:bg-danger/16',
    info: 'bg-info/10 text-(--lar-info-text) dark:bg-info/16',
};

export function Badge({ tone = 'neutral', hue, className = '', style, ...props }: BadgeProps) {
    return (
        <NinnaBadge
            {...props}
            color={tone === 'accent' ? 'primary' : tone}
            size="sm"
            variant="soft"
            style={hue === undefined ? style : ({ ...style, '--lar-kind-hue': hue } as CSSProperties)}
            className={`h-5 gap-1 rounded-sm px-1.5 text-xs font-medium [&>svg]:size-3 [&>svg]:shrink-0 ${hue === undefined ? toneClasses[tone] : 'kind-badge!'} ${className}`}
        />
    );
}
