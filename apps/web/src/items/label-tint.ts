// A tracker's label colour as a chip's style. A label's colour says nothing about what it sits on, so the text starts from a
// mix with the foreground and moves towards the foreground, in each mode, until it reaches the contrast a chip's name needs.

type Rgb = readonly [number, number, number];
type Mode = 'light' | 'dark';

/** WCAG AA for text this small. */
export const CONTRAST_FLOOR = 4.5;

/** The palette's foreground, and the surface a chip's text contrasts least with: the accent a hovered or picked row fills with. */
export const PALETTE: Record<Mode, { foreground: string; surface: string }> = {
  light: { foreground: '#27272a', surface: '#f4f4f5' },
  dark: { foreground: '#f5f5f5', surface: '#161616' },
};

const FILL = 0.16;
const TEXT_SHARE = 0.55;

const rgbOf = (hex: string): Rgb | null => {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  return digits ? [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as unknown as Rgb : null;
};
const mixed = (a: Rgb, b: Rgb, share: number): Rgb => a.map((part, at) => part * share + b[at]! * (1 - share)) as unknown as Rgb;
const hexOf = (color: Rgb) => `#${color.map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;

const luminance = (color: Rgb): number => {
  const [r, g, b] = color.map((part) => {
    const linear = part / 255;
    return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio of two colours. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(rgbOf(a)!), luminance(rgbOf(b)!)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** A chip's fill in `mode`, as tint's `color-mix` paints it over the palette's surface. */
export const chipFill = (color: string, mode: Mode): string => hexOf(mixed(rgbOf(color)!, rgbOf(PALETTE[mode].surface)!, FILL));

/** A chip's text in `mode`: as much of the label's colour as the contrast floor allows. The foreground alone always clears it. */
export function chipText(color: string, mode: Mode): string {
  const label = rgbOf(color)!;
  const foreground = rgbOf(PALETTE[mode].foreground)!;
  const fill = chipFill(color, mode);
  for (let share = TEXT_SHARE; share > 0; share -= 0.05) {
    const text = hexOf(mixed(label, foreground, share));
    if (contrastRatio(text, fill) >= CONTRAST_FLOOR) return text;
  }
  return PALETTE[mode].foreground;
}

/** A soft tint of a tracker's label colour with its name readable in both modes; none, or one that isn't a colour, keeps the Badge's neutral style. */
export const tint = (color: string | undefined) => (color && rgbOf(color) ? {
  backgroundColor: `color-mix(in srgb, ${color} ${FILL * 100}%, transparent)`,
  color: `light-dark(${chipText(color, 'light')}, ${chipText(color, 'dark')})`,
  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)`,
} : undefined);
