// What the closed field shows in the room it has. Tokens go from the last, into a count, while the word Search and the
// count still fit; the key hint shows only with every token and room to spare; below the word's room, or on the narrowest
// title bar, the field folds to its magnifier with a count. Widths are in pixels, in the field's `text-xs`.

/** The field's left padding, magnifier, gap and right padding. */
const CHROME = 34;
const SEARCH_WORD = 42;
const COUNT = 24;
const KEY_HINT = 34;
const GAP = 4;
/** lar-server's trigger width, which the field keeps until its tokens ask for more. */
const MIN_WIDTH = 224;
/** Up to this title bar width, the smallest phones', the field folds. Its row there still has room for the word, as the
 *  bar gives its actions their own row, so the room alone would never fold it. */
const NARROWEST_BAR = 340;

interface FieldRoom {
  /** What the field may fill. */
  field: number;
  /** The title bar's width. */
  bar: number;
}

export interface FieldFit {
  /** How many tokens show; the rest are in the count. */
  shown: number;
  keyHint: boolean;
  folded: boolean;
  width: number;
}

export function fitField({ field: room, bar }: FieldRoom, tokenWidths: readonly number[]): FieldFit {
  const tokens = (count: number) => tokenWidths.slice(0, count).reduce((sum, width) => sum + width + GAP, 0);
  const used = (count: number) => CHROME + SEARCH_WORD + tokens(count) + (count < tokenWidths.length ? COUNT + GAP : 0);
  let shown = tokenWidths.length;
  while (shown > 0 && used(shown) > room) shown--;
  return {
    shown,
    keyHint: shown === tokenWidths.length && used(shown) + KEY_HINT + GAP <= room,
    folded: bar <= NARROWEST_BAR || used(shown) > room,
    width: Math.min(room, Math.max(MIN_WIDTH, used(tokenWidths.length) + KEY_HINT + GAP)),
  };
}
