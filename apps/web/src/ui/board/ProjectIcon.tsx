// A project's icon, in a fixed square. An emoji or monogram chosen in T3 takes the square. Otherwise it holds T3's
// monogram of the project's name (two characters in the name's colour, as T3 draws a project with no icon), with the
// favicon or lucide icon laid over it once that has loaded, so the square keeps its size either way and a missing or
// broken one leaves the monogram.
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

/** The square and its type on the board's icon scale: `sm` 14px (a chip's), `md` 16px (a row's, a card's, a list of
 *  projects' and a navigation pane's, as T3 draws a project beside its name) and `lg` 20px. Its corners round at 25%,
 *  as T3's do.
 *  A monogram is T3's two-character tile, scaled to the square; an emoji fills about as much of its square as a lucide
 *  icon's strokes do, so a row's icons line up. */
const SIZES = {
    sm: { square: 'size-3.5 rounded-[25%] text-xs', emoji: 'text-xs' },
    md: { square: 'size-4 rounded-[25%] text-xs', emoji: 'text-sm' },
    lg: { square: 'size-5 rounded-[25%] text-xs', emoji: 'text-base' },
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

const OVERLAY = 'absolute inset-0 size-full';

/** lucide's name map and its icons are lazy chunks, loaded when first shown. DynamicIcon draws nothing for a name
 *  lucide lacks or an icon that won't load, and a name map that won't load draws nothing here. */
const LucideIcon = lazy<ComponentType<ComponentProps<typeof DynamicIcon>>>(() =>
    import('@lar-works/design-system/icons/dynamic').then(
        (lucide) => ({ default: lucide.DynamicIcon }),
        () => ({ default: () => null }),
    ),
);

/** A project's image as T3 draws it (apps/web/src/components/ProjectFavicon.tsx): the whole image scaled into the
 *  square, with its 25% corners, on nothing of its own; hidden until it has loaded, and gone if it fails. The square
 *  adds a hairline at its edge over it (ProjectIcon). */
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
            className={`absolute inset-0 size-full rounded-[25%] object-contain${loaded ? '' : ' hidden'}`}
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

/** T3's project colours as T3 draws them (apps/web/src/projectIconColors.ts in T3 Code), in its order, which its
 *  name hash indexes, so a project gets the same colour here as in T3. Whole class names, as Tailwind only finds those. */
const T3_COLORS: readonly [ProjectIconColor, string][] = [
    ['gray', 'text-gray-600 dark:text-gray-400'],
    ['red', 'text-red-600 dark:text-red-400'],
    ['orange', 'text-orange-600 dark:text-orange-400'],
    ['amber', 'text-amber-600 dark:text-amber-400'],
    ['yellow', 'text-yellow-600 dark:text-yellow-400'],
    ['lime', 'text-lime-600 dark:text-lime-400'],
    ['green', 'text-green-600 dark:text-green-400'],
    ['emerald', 'text-emerald-600 dark:text-emerald-400'],
    ['teal', 'text-teal-600 dark:text-teal-400'],
    ['cyan', 'text-cyan-600 dark:text-cyan-400'],
    ['sky', 'text-sky-600 dark:text-sky-400'],
    ['blue', 'text-blue-600 dark:text-blue-400'],
    ['indigo', 'text-indigo-600 dark:text-indigo-400'],
    ['violet', 'text-violet-600 dark:text-violet-400'],
    ['purple', 'text-purple-600 dark:text-purple-400'],
    ['fuchsia', 'text-fuchsia-600 dark:text-fuchsia-400'],
    ['pink', 'text-pink-600 dark:text-pink-400'],
    ['rose', 'text-rose-600 dark:text-rose-400'],
];
const T3_COLOR_CLASS = Object.fromEntries(T3_COLORS) as Record<ProjectIconColor, string>;

const normalizedName = (name: string) => name.normalize('NFKC').trim();

/** A project's two-character monogram as T3 derives it (apps/web/src/projectIdentity.ts): the first word's first
 *  character, then the first digit after it, else the last word's first character, else the first word's last. */
function projectMonogram(name: string): string {
    const words = normalizedName(name).match(/[\p{L}\p{N}]+/gu) ?? [];
    const firstWord = words[0];

    if (!firstWord) return 'PR';

    const glyphs = Array.from(firstWord);
    const first = glyphs[0] ?? 'P';
    const second =
        glyphs.slice(1).find((glyph) => /\p{N}/u.test(glyph)) ??
        (words.length > 1 ? Array.from(words.at(-1) ?? '')[0] : glyphs.at(-1)) ??
        first;

    return Array.from(`${first}${second}`.toUpperCase()).slice(0, 2).join('');
}

/** A project's colour as T3 derives it from its name, so it matches T3's. */
function projectColor(name: string): ProjectIconColor {
    const seed = normalizedName(name).toLocaleLowerCase('en-US') || 'project';
    let index = 0;

    for (const glyph of seed) index = (index * 31 + (glyph.codePointAt(0) ?? 0)) % T3_COLORS.length;

    return T3_COLORS[index]?.[0] ?? 'blue';
}

const monogramSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** T3's monogram tile (apps/web/src/components/ProjectMonogram.tsx): the text in bold monospace, stretched to one
 *  width, in the colour on a 14% tint of it, in a square with 25% corners that fills its parent. */
function Monogram({ text, color }: { text: string; color: ProjectIconColor }) {
    return (
        <svg
            viewBox="0 0 16 16"
            data-monogram
            className={`absolute inset-0 size-full overflow-hidden rounded-[25%] font-mono select-none ${T3_COLOR_CLASS[color]}`}
            style={{ backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)' }}
        >
            <text
                x="8"
                y="10.8"
                textAnchor="middle"
                fill="currentColor"
                className="font-mono"
                fontSize="8.25"
                fontWeight="700"
                textLength={Array.from(monogramSegmenter.segment(text)).length === 1 ? 6 : 12}
                lengthAdjust="spacingAndGlyphs"
                textRendering="geometricPrecision"
            >
                {text}
            </text>
        </svg>
    );
}

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
    /** The square's size on the board's icon scale: `sm` 14px, `md` 16px (a row's, a project list's) or `lg` 20px. */
    size: ProjectIconSize;
} & DataAttributes) {
    const { square, emoji } = SIZES[size];
    const own = place === undefined ? null : PLACE_HUES[place % PLACE_HUES.length]!;
    const hue = (color: ProjectIconColor) => T3_HUES[color] ?? own;
    const tinted = (h: CategoricalHue | null, recipe: string) => (h ? `${HUES[h]} ${recipe}` : 'text-fg-muted');
    const shared = `${square} relative grid shrink-0 place-items-center overflow-hidden leading-none font-semibold`;

    if (icon?.kind === 'emoji')
        return (
            <span {...data} data-project-icon className={shared} aria-hidden="true">
                <span className={`${emoji} leading-none`}>{icon.emoji}</span>
            </span>
        );

    if (icon?.kind === 'monogram')
        return (
            <span {...data} data-project-icon className={shared} aria-hidden="true">
                <Monogram text={firstGraphemes(icon.text, 2)} color={icon.color} />
            </span>
        );

    return (
        <span {...data} data-project-icon className={shared} aria-hidden="true">
            {/* With no icon, or until its image or icon has drawn (or if it never does), T3's monogram of the name:
                two characters in the name's own colour, as T3 shows the same project. */}
            <span className="absolute inset-0 [[data-project-icon]:has(img:not([hidden]),[data-lucide]_svg)>&]:invisible">
                <Monogram text={projectMonogram(name)} color={projectColor(name)} />
            </span>
            {icon?.kind === 'favicon' && <Favicon key={icon.src} src={icon.src} />}
            {/* A hairline at the image's own edge, so a dark tile on the dark page reads at the square's full size, as a
                light one does, and every project's icon looks the same size. Only over a loaded image. */}
            {icon?.kind === 'favicon' && (
                <span className="ring-line pointer-events-none absolute inset-0 rounded-[25%] ring-1 ring-inset [[data-project-icon]:not(:has(img:not([hidden])))>&]:hidden" />
            )}
            {icon?.kind === 'lucide' && (
                // The colour is the wrapper's and the icon draws in currentColor, so a container that recolours every
                // svg in it (a palette row's icon box) can't turn it into its own colour. The wrapper draws nothing of
                // its own, so the initial shows until the icon has loaded, the same in either theme.
                <span data-lucide className={`absolute inset-0 ${tinted(hue(icon.color), 'categorical-icon')}`}>
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
