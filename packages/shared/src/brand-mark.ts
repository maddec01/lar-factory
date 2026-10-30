// The lar mark, from lar-brand's brand/SPEC.md: an L in the ink colour and a block that is always
// BRAND_BLOCK_COLOR, on a 100-unit box. The L has flat ends, a square inner corner and a 3-unit outer corner; the
// block is a 57.35 square with 8.03 corners. The page draws it in its header; index.html's favicon copies it.

export const BRAND_MARK_VIEWBOX = '0 0 100 100';
export const BRAND_MARK_L = 'M0 0H27.52V72.48H100V100H3a3 3 0 0 1-3-3z';
export const BRAND_MARK_BLOCK = 'M50.68 0H91.97a8.03 8.03 0 0 1 8.03 8.03V49.32a8.03 8.03 0 0 1-8.03 8.03H50.68a8.03 8.03 0 0 1-8.03-8.03V8.03a8.03 8.03 0 0 1 8.03-8.03z';
export const BRAND_BLOCK_COLOR = '#355292';
/** The L's centre line, from the top of the stem to the end of the foot. Stroked BRAND_MARK_BAR wide with butt caps
 *  and a miter join, it covers BRAND_MARK_L but for the L's 3-unit outer corner, which it draws square. The loading
 *  screens trace it. */
export const BRAND_MARK_BAR = 27.52;
export const BRAND_MARK_CENTRE_LINE = `M${BRAND_MARK_BAR / 2} 0V${100 - BRAND_MARK_BAR / 2}H100`;
