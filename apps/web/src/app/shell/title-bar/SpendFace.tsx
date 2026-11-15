// The spend counter's value, notice and accessible summary, including partial, unavailable and loading figures.

import { plural, wholeUsd } from '@lar-factory/shared';

import { CounterDash, CounterPartial } from '@/ui/board';

/** What the spend counter says. The bar and the panel's total give whole dollars ($700), the panel's items cents. While some usage is still loading
 *  the bar never shows the part summed so far: it keeps the last complete total, or a quiet dash before there is one.
 *  Only usage that is unavailable leaves a known figure marked with a plus, which its tooltip explains. */
export function spendFace({
    total,
    known,
    unavailable,
    loading,
    settled,
}: {
    /** The sum of every priced item now. */
    total: number;
    /** Some item is priced. */
    known: boolean;
    /** Some usage can't be read. */
    unavailable: boolean;
    /** Some usage is still being read. */
    loading: boolean;
    /** The last total read with nothing loading or unavailable, if there was one. */
    settled: number | null;
}) {
    const partial = known && (unavailable || loading);
    const figure = wholeUsd(total);
    const notice = partial
        ? `Partial figures. Some usage is ${unavailable ? 'unavailable' : 'still loading'}.`
        : unavailable
          ? 'Usage is unavailable.'
          : loading
            ? 'Usage totals are still loading.'
            : null;

    return {
        /** What the panel's foot says while its figures are partial. */
        notice: partial ? notice : null,
        /** The bar's tooltip, when it says more than the usual one. */
        hint: loading && !unavailable && settled !== null ? 'The last complete total. Usage is still loading.' : notice,
        value:
            known && unavailable ? (
                <CounterPartial figure={wholeUsd(total)} />
            ) : unavailable ? (
                <CounterDash />
            ) : loading ? (
                settled === null ? (
                    <CounterDash />
                ) : (
                    wholeUsd(settled)
                )
            ) : (
                wholeUsd(total)
            ),
        sub: partial ? `${figure} so far` : unavailable ? 'Unavailable' : loading ? 'Loading' : figure,
    };
}

/** What the spend panel covers, beside its total: every project's open work and the work finished in the days before
 *  the board hides it (Settings › Archive), as the board holds no older work. */
export function spendScope(hideAfterDays: number | undefined): string {
    if (hideAfterDays === undefined) return 'All open work, and recently finished work';

    if (hideAfterDays === 0) return 'All open work';

    return `All open work, and work finished in the last ${plural(hideAfterDays, 'day')}`;
}
