// The small pieces the item dialog's details share: section headings, people, loading placeholders and the meta area's facts.

import { shortAgo } from '@lar-factory/shared';
import type { ReactNode } from 'react';

export const Heading = ({ children }: { children: ReactNode }) => (
    <h2 className="m-0 text-[13px] font-medium text-(--muted-foreground)">{children}</h2>
);

export const Avatar = ({ name }: { name: string }) => (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-(--secondary) text-[11px] font-semibold text-(--secondary-foreground) uppercase">
        {name[0]}
    </span>
);

export const Person = ({ name }: { name: string }) => (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <Avatar name={name} />
        <span className="min-w-0 wrap-anywhere">{name}</span>
    </span>
);

export const Placeholder = ({ className }: { className: string }) => (
    <div className={`animate-pulse rounded bg-(--muted) ${className}`} />
);

/** A labelled fact for the meta area; its value wraps rather than runs past the dialog. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex max-w-full min-w-0 items-baseline gap-1.5 text-sm">
            <span className="shrink-0 text-xs text-(--muted-foreground)">{label}</span>
            <span className="min-w-0 wrap-anywhere">{children}</span>
        </div>
    );
}

export const When = ({ iso, now }: { iso: string; now: number }) => (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
        {shortAgo(iso, now)}
    </time>
);

export const LABEL_ERROR = 'm-0 text-xs text-(--error-foreground)';
