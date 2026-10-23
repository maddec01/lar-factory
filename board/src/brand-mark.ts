// The Mux logo: viewBox and path copied unchanged from mux-server's BrandMark.tsx.
// The page draws it in its header; the server makes the favicon from it.

export const BRAND_MARK_VIEWBOX = '0 0 56 32';
export const BRAND_MARK_PATH = 'M5 3.5v25M5 3.5V12a8.5 8.5 0 0 0 17 0V3.5M22 12c0 4.5 2 7.5 5.5 7.5M36 3.5l14 17M50 3.5l-14 17';

export const BRAND_MARK = `<svg class="brand-mark" role="img" aria-label="Mux" viewBox="${BRAND_MARK_VIEWBOX}" fill="none"><path d="${BRAND_MARK_PATH}" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
