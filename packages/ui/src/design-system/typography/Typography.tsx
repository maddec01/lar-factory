import type { HTMLAttributes } from 'react';

import { SkeletonLoader } from '../feedback/SkeletonLoader';

const textStyles = {
    body: 'text-sm leading-5',
    description: 'text-[15px] leading-6',
    caption: 'text-xs leading-4',
    label: 'text-sm font-medium leading-5',
    overline: 'text-[11px] font-semibold uppercase leading-4 tracking-[0.08em]',
    metric: 'text-2xl font-semibold leading-8 tracking-[-0.02em] tabular-nums',
} as const;

/** T3's headings: semibold with tightening tracking as they grow; the hero takes t3.codes' display setting. */
const headingStyles = {
    page: 'text-[1.375rem] font-semibold leading-7 tracking-[-0.02em]',
    section: 'text-base font-semibold leading-6 tracking-[-0.01em]',
    subsection: 'text-[15px] font-semibold leading-6 tracking-[-0.005em]',
    title: 'text-sm font-semibold leading-5',
    label: 'text-sm font-semibold leading-5',
    hero: 'text-3xl font-semibold leading-[1.05] tracking-[-0.035em] [text-box:trim-both_cap_alphabetic] sm:text-4xl lg:text-[2.875rem]',
} as const;

const tones = {
    default: 'text-base-content',
    muted: 'text-base-700',
    danger: 'text-danger',
    warning: 'text-warning',
    success: 'text-success',
} as const;

interface TypographyProps extends HTMLAttributes<HTMLElement> {
    loading?: boolean;
    tone?: keyof typeof tones;
    truncate?: boolean;
}

export interface TextProps extends TypographyProps {
    as?: 'p' | 'span' | 'div';
    variant?: keyof typeof textStyles;
}

export function Text({
    as: Tag = 'p',
    variant = 'body',
    tone = 'default',
    truncate,
    loading,
    className = '',
    children,
    ...props
}: TextProps) {
    return (
        <Tag
            {...props}
            className={`${textStyles[variant]} ${tones[tone]} ${truncate ? 'truncate' : ''} ${loading ? `relative ${Tag === 'span' ? 'inline-block w-full' : ''}` : ''} ${className}`}
        >
            {loading ? <LoadingText /> : children}
        </Tag>
    );
}

export interface HeadingProps extends TypographyProps {
    as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    variant?: keyof typeof headingStyles;
}

export function Heading({
    as: Tag = 'h2',
    variant = 'section',
    tone = 'default',
    truncate,
    loading,
    className = '',
    children,
    ...props
}: HeadingProps) {
    return (
        <Tag
            {...props}
            className={`${headingStyles[variant]} ${tones[tone]} ${truncate ? 'truncate' : ''} ${loading ? 'relative' : ''} ${className}`}
        >
            {loading ? <LoadingText heading={variant === 'hero'} /> : children}
        </Tag>
    );
}

/** An invisible glyph retains the font's line box, including cap-height trimming. */
function LoadingText({ heading = false }: { heading?: boolean }) {
    return (
        <>
            <span aria-hidden="true" className="invisible">
                &nbsp;
            </span>
            <span aria-hidden="true" className="absolute inset-0 flex items-center">
                <SkeletonLoader.Shape presentation={heading ? 'heading' : 'line'} />
            </span>
        </>
    );
}
