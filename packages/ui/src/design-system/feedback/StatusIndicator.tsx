export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusIndicatorProps {
    className?: string;
    size?: 'sm' | 'md';
    tone: StatusTone;
}

const toneClasses: Record<StatusTone, string> = {
    neutral: 'bg-base-400',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
};

const sizeClasses: Record<NonNullable<StatusIndicatorProps['size']>, string> = {
    sm: 'size-1.5',
    md: 'size-2',
};

export function StatusIndicator({ className, size = 'md', tone }: StatusIndicatorProps) {
    const classes = ['inline-block shrink-0 rounded-full', sizeClasses[size], toneClasses[tone], className]
        .filter(Boolean)
        .join(' ');

    return <span aria-hidden="true" className={classes} />;
}
