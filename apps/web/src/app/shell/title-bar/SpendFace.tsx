// The spend counter's value, notice and accessible summary, including partial, unavailable and loading figures.

import { Loading } from '@lar-works/design-system';

import { CounterDash, CounterPartial } from '@/ui/board';

/** What the spend counter says: a figure once it knows one, marked with a plus while it covers only part of the usage. */
export function spendFace(figure: string, known: boolean, unavailable: boolean, loading: boolean) {
    const partial = known && (unavailable || loading);
    const why = unavailable ? 'Some usage is unavailable.' : 'Some usage is still loading.';

    return {
        partial,
        notice: partial
            ? `Partial figures. ${why}`
            : unavailable
              ? 'Usage is unavailable.'
              : loading
                ? 'Usage totals are still loading.'
                : null,
        value: partial ? (
            <CounterPartial figure={figure} unavailable={unavailable} />
        ) : unavailable ? (
            <CounterDash />
        ) : loading ? (
            <Loading presentation="inline" title="Usage totals are still loading." />
        ) : (
            figure
        ),
        sub: partial ? `${figure} so far` : unavailable ? 'Unavailable' : loading ? 'Loading' : figure,
    };
}
