// Announce transitions seen by this page, including merges outside the board; initial history stays quiet.
import { useEffect } from 'react';

import { notify } from './Notices';
import { useBoardStore } from '@/services/board/board.hooks';

export function CompletionNotices() {
    useEffect(
        () =>
            useBoardStore.subscribe((next, previous) => {
                if (!previous.loaded || next.data.items === previous.data.items) return;

                const before = new Map(previous.data.items.map((item) => [item.id, item]));

                for (const item of next.data.items) {
                    const old = before.get(item.id);

                    if (!old || item.setAside) continue;

                    if (item.status === 'Done' && old.status !== 'Done') notify({ verb: 'Done', item });
                    else if (
                        item.status !== 'Done' &&
                        item.linkedPrs.some(
                            (pr) =>
                                pr.state === 'merged' &&
                                !old.linkedPrs.some((was) => was.url === pr.url && was.state === 'merged'),
                        )
                    )
                        notify({ verb: 'Merged', item });
                }
            }),
        [],
    );

    return null;
}
