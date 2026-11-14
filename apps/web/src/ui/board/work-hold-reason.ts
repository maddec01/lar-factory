/** Translate record vocabulary once, where the board presents a group's holds. */
export function workHoldReason(reason: string): string {
    if (reason === "Its Fog isn't gone.") return 'Open questions still need answers.';

    if (reason === 'Its map is empty.') return 'No parts mapped yet.';

    if (/^Outcome check (pending|failed):/.test(reason)) return reason.split(':')[0]!;

    return reason.replace(/^Its build (.+) isn't Done\.$/, '$1 is not built yet.');
}
