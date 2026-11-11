// A project's icon, in a fixed square, in the project's hue on the design system's categorical palette. An emoji or
// monogram chosen in T3 takes the square. Otherwise it holds the tinted initial, with the favicon or lucide icon laid
// over it once that has loaded, so the square keeps its size either way and a missing or broken one leaves the initial.
// Decorative, as a name sits beside it. An SVG favicon only ever renders through this <img>, which runs none of its
// scripts.

import { type CategoricalHue, categoricalHues } from '@lar-works/design-system';
import type { DynamicIcon } from '@lar-works/design-system/icons/dynamic';
import { lazy, Suspense, useState, type ComponentProps, type ComponentType } from 'react';

import type { DataAttributes } from './DataAttributes';

/** T3's project icon colours, which tint a lucide icon or a monogram. */
type ProjectIconColor =
    | 'gray'
    | 'red'
    | 'orange'
    | 'amber'
    | 'yellow'
    | 'lime'
    | 'green'
    | 'emerald'
    | 'teal'
    | 'cyan'
    | 'sky'
    | 'blue'
    | 'indigo'
    | 'violet'
    | 'purple'
    | 'fuchsia'
    | 'pink'
    | 'rose';

/** What a project's square shows over its initial: a lucide icon by name, an emoji, up to two characters of a
 *  monogram, or a favicon at `src`. */
export type ProjectIconSource =
    | { kind: 'lucide'; name: string; color: ProjectIconColor }
    | { kind: 'emoji'; emoji: string }
    | { kind: 'monogram'; text: string; color: ProjectIconColor }
    | { kind: 'favicon'; src: string };

/** The palette's hues in the order the repositories take them (by their place in the board's list). */
const PLACE_HUES = Object.keys(categoricalHues) as CategoricalHue[];

/** The square and its type on the board's icon scale: `sm` 14px (a chip's), `md` 16px (a row's) and `lg` 20px. Its
 *  initial or monogram is 12px (the meta size), so a small square shows one character and only `lg` two; an emoji
 *  fills about as much of its square as a lucide icon's strokes do, so a row's icons line up. */
const SIZES = {
    sm: { square: 'size-3.5 text-xs', emoji: 'text-xs', graphemes: 1 },
    md: { square: 'size-4 text-xs', emoji: 'text-sm', graphemes: 1 },
    lg: { square: 'size-5 text-xs', emoji: 'text-base', graphemes: 2 },
};

export type ProjectIconSize = keyof typeof SIZES;

/** Each categorical hue as whole class names, as Tailwind only finds those. */
const HUES: Record<CategoricalHue, string> = {
    lime: 'category-lime',
    teal: 'category-teal',
    cyan: 'category-cyan',
    violet: 'category-violet',
    magenta: 'category-magenta',
    rose: 'category-rose',
};

/** T3's project icon colours on the categorical palette: each to its nearest hue there, so a project keeps the colour
 *  family it was given in T3 without drawing in a status's hue. Gray takes the project's own hue. */
const T3_HUES: Record<ProjectIconColor, CategoricalHue | null> = {
    gray: null,
    red: 'rose',
    orange: 'rose',
    amber: 'lime',
    yellow: 'lime',
    lime: 'lime',
    green: 'teal',
    emerald: 'teal',
    teal: 'teal',
    cyan: 'cyan',
    sky: 'cyan',
    blue: 'cyan',
    indigo: 'violet',
    violet: 'violet',
    purple: 'violet',
    fuchsia: 'magenta',
    pink: 'magenta',
    rose: 'rose',
};

const OVERLAY = 'absolute inset-0 size-full bg-surface-raised';

/** lucide's name map and its icons are lazy chunks, loaded when first shown. DynamicIcon draws nothing for a name
 *  lucide lacks or an icon that won't load, and a name map that won't load draws nothing here. */
const LucideIcon = lazy<ComponentType<ComponentProps<typeof DynamicIcon>>>(() =>
    import('@lar-works/design-system/icons/dynamic').then(
        (lucide) => ({ default: lucide.DynamicIcon }),
        () => ({ default: () => null }),
    ),
);

function Favicon({ src }: { src: string }) {
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);

    if (failed) return null;

    return (
        <img
            src={src}
            alt=""
            hidden={!loaded}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`${OVERLAY} object-contain${loaded ? '' : ' hidden'}`}
        />
    );
}

const graphemes = new Intl.Segmenter();
const firstGraphemes = (text: string, count: number) => {
    let shown = '';
    let length = 0;

    for (const { segment } of graphemes.segment(text)) {
        shown += segment;

        if (++length === count) break;
    }

    return shown;
};

/**
 * A project's icon in a square of its `size`: `icon`, or its `name`'s initial in the categorical hue of its `place` among
 * the board's repositories (muted for a project the board doesn't list), with a favicon or lucide icon laid over the
 * initial once it has loaded. A lucide icon or monogram from T3 keeps T3's colour, on the palette.
 */
export function ProjectIcon({
    icon,
    name,
    place,
    size,
    ...data
}: {
    /** The project's own icon: an image, an SVG or a loader; none draws its initial. */
    icon?: ProjectIconSource | null | undefined;
    /** The project's name, whose initial stands in for a missing icon. */
    name: string;
    /** The project's place among the board's repositories, which picks its hue; none mutes it. */
    place?: number | undefined;
    /** The square's size on the board's icon scale: `sm` 14px, `md` 16px (a row's) or `lg` 20px. */
    size: ProjectIconSize;
} & DataAttributes) {
    const { square, emoji, graphemes: shown } = SIZES[size];
    const own = place === undefined ? null : PLACE_HUES[place % PLACE_HUES.length]!;
    const hue = (color: ProjectIconColor) => T3_HUES[color] ?? own;
    const tinted = (h: CategoricalHue | null, recipe: string) => (h ? `${HUES[h]} ${recipe}` : 'text-fg-muted');
    const shared = `${square} relative grid shrink-0 place-items-center overflow-hidden rounded-md leading-none font-semibold`;

    if (icon?.kind === 'emoji')
        return (
            <span {...data} data-project-icon className={shared} aria-hidden="true">
                <span className={`${emoji} leading-none`}>{icon.emoji}</span>
            </span>
        );

    if (icon?.kind === 'monogram')
        return (
            <span
                {...data}
                data-project-icon
                className={`${shared} ${tinted(hue(icon.color), 'categorical-text')}`}
                aria-hidden="true"
            >
                <span className="whitespace-nowrap">{firstGraphemes(icon.text, shown)}</span>
            </span>
        );

    return (
        <span
            {...data}
            data-project-icon
            // An image laid over the initial covers the square edge to edge, so only the initial wears the fill's edge.
            className={`${shared} ${icon?.kind === 'lucide' || icon?.kind === 'favicon' ? '' : 'border'} ${own ? `${HUES[own]} categorical-fill` : 'bg-fill-muted text-fg-muted border-line'}`}
            aria-hidden="true"
        >
            {firstGraphemes(name, 1).toUpperCase()}
            {icon?.kind === 'favicon' && <Favicon key={icon.src} src={icon.src} />}
            {icon?.kind === 'lucide' && (
                // The colour is the wrapper's and the icon draws in currentColor, so a container that recolours every
                // svg in it (a palette row's icon box) can't turn it into its own colour. The wrapper draws nothing of
                // its own, so the initial shows until the icon has loaded, the same in either theme.
                <span className={`absolute inset-0 ${tinted(hue(icon.color), 'categorical-icon')}`}>
                    <Suspense fallback={null}>
                        <LucideIcon
                            key={icon.name}
                            name={icon.name as ComponentProps<typeof DynamicIcon>['name']}
                            className={`${OVERLAY} text-current`}
                        />
                    </Suspense>
                </span>
            )}
        </span>
    );
}
