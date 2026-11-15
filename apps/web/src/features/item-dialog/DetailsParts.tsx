// The small pieces the item dialog's details share: when something happened.

import { shortAgo } from '@lar-factory/shared';

export const When = ({ iso, now }: { iso: string; now: number }) => (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
        {shortAgo(iso, now)}
    </time>
);
