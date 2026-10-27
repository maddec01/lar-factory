import type { StatusTone } from '../feedback/StatusIndicator';

/** A small square holding an icon, tinted by tone: T3 Code's 8% tint behind its foreground colour. */
export const toneTileClasses: Record<StatusTone, string> = {
    neutral: 'bg-base-200 text-base-700 ring-1 ring-inset ring-base-300/70 dark:bg-base-300/60',
    success: 'bg-success/10 text-(--lar-success-text) dark:bg-success/16',
    warning: 'bg-warning/12 text-(--lar-warning-text) dark:bg-warning/16',
    danger: 'bg-danger/10 text-(--lar-danger-text) dark:bg-danger/16',
    info: 'bg-info/10 text-(--lar-info-text) dark:bg-info/16',
};
