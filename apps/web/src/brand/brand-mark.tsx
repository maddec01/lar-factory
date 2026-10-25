// The lar mark: the L in the text colour and the block in the brand's blue. Its bottom edge sits on the text's
// baseline in a baseline-aligned row, and at 0.705em it is flush with the top of a lowercase l (lar-brand's SPEC.md).

import { BRAND_BLOCK_COLOR, BRAND_MARK_BLOCK, BRAND_MARK_L, BRAND_MARK_VIEWBOX } from '@lar-factory/shared';

export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg className={className} viewBox={BRAND_MARK_VIEWBOX} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <path d={BRAND_MARK_L} fill="currentColor" />
      <path d={BRAND_MARK_BLOCK} fill={BRAND_BLOCK_COLOR} />
    </svg>
  );
}
