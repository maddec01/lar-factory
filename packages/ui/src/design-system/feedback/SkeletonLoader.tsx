/* eslint-disable react-refresh/only-export-components -- Compound members are exported through SkeletonLoader. */

import { Fragment, type ReactNode } from 'react';

type SkeletonPresentation =
    'artwork' | 'poster' | 'card' | 'chart' | 'circle' | 'control' | 'heading' | 'line' | 'metric';
type SkeletonWidth = 'action' | 'full' | 'medium' | 'short' | 'wide';

const presentationClasses: Record<SkeletonPresentation, string> = {
    artwork: 'aspect-square',
    poster: 'aspect-[2/3]',
    card: 'h-32',
    chart: 'h-36',
    circle: 'size-9',
    control: 'h-10',
    heading: 'h-[1cap]',
    line: 'h-3.5',
    metric: 'h-8',
};

const presentationRadius = {
    artwork: 'rounded-lg',
    poster: 'rounded-lg',
    card: 'rounded-xl',
    chart: 'rounded-md',
    circle: 'rounded-full',
    control: 'rounded-md',
    heading: 'rounded-md',
    line: 'rounded-full',
    metric: 'rounded-md',
} as const;

const widthClasses: Record<SkeletonWidth, string> = {
    action: 'w-20',
    full: 'w-full',
    medium: 'w-1/2',
    short: 'w-1/3',
    wide: 'w-3/4',
};

interface SkeletonLoaderProps {
    children: ReactNode;
    label: string;
    loading?: boolean;
}

function SkeletonLoaderRoot({ children, label, loading = true }: SkeletonLoaderProps) {
    if (!loading) return <Fragment>{children}</Fragment>;

    return (
        <div role="status" aria-busy="true" aria-label={label}>
            <div aria-hidden="true">{children}</div>
        </div>
    );
}

interface SkeletonShapeProps {
    presentation?: SkeletonPresentation;
    width?: SkeletonWidth;
}

function SkeletonShape({ presentation = 'line', width = 'full' }: SkeletonShapeProps) {
    const classes = [presentationClasses[presentation], presentation === 'circle' ? null : widthClasses[width]]
        .filter(Boolean)
        .join(' ');

    return (
        <span
            aria-hidden="true"
            role="presentation"
            data-slot="skeleton"
            className={`lar-skeleton block ${classes} ${presentationRadius[presentation]}`}
        />
    );
}

export const SkeletonLoader = Object.assign(SkeletonLoaderRoot, { Shape: SkeletonShape });
