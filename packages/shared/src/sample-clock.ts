/** Move fixture timestamps together, leaving prose, cursors and date-only values untouched. */
export function rebaseSampleTimes<T>(value: T, offsetMs: number): T {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
        const shifted = new Date(Date.parse(value) + offsetMs);

        return (Number.isFinite(shifted.getTime()) ? shifted.toISOString() : value) as T;
    }

    if (Array.isArray(value)) return value.map((entry) => rebaseSampleTimes(entry, offsetMs)) as T;

    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, rebaseSampleTimes(entry, offsetMs)]),
        ) as T;

    return value;
}
