// The small pieces the item dialog's details share: loading placeholders and when something happened.

import { shortAgo } from '@lar-factory/shared';
import { SkeletonLoader } from '@lar-works/design-system';

/** A short placeholder for a fact or a heading's content while the details load. */
export const Placeholder = () => <SkeletonLoader.Shape width="action" />;

export const When = ({ iso, now }: { iso: string; now: number }) => (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
        {shortAgo(iso, now)}
    </time>
);
