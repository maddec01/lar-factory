// Work closed by a shaping thread leaves the board through set-aside. Read its retained Archive entry before
// announcing the close, so View item can open it. A failed read retries on the next board snapshot.

import { ref } from '@lar-factory/shared';
import { useEffect } from 'react';

import { ViewButton } from './AddedNotice';
import { showToast } from './ToastActions';
import { useArchiveStore } from '@/services/archive/archive.hooks';
import { useBoardStore } from '@/services/board/board.hooks';

export function useClosureNotices(): void {
    useEffect(() => {
        const pending = new Set<string>();
        const state = { reading: false, stopped: false };

        const read = async () => {
            if (state.reading || !pending.size) return;

            const requested = new Set(pending);

            state.reading = true;
            await useArchiveStore.getState().load();
            state.reading = false;

            if (state.stopped || useArchiveStore.getState().loading || useArchiveStore.getState().problem) return;

            for (const item of useArchiveStore.getState().items ?? []) {
                if (!pending.delete(item.id) || !item.closeReason) continue;

                showToast({
                    slot: `closed:${item.id}`,
                    what: `Closed ${ref(item)}`,
                    body: (
                        <>
                            Closed {ref(item)} {item.closeReason}. <ViewButton item={item} slot={`closed:${item.id}`} />
                        </>
                    ),
                });
            }
            for (const id of requested) pending.delete(id);
        };
        // Search or Settings may supersede this read. Once that newer read settles, read the pending closes again.
        const stopArchive = useArchiveStore.subscribe((archive, before) => {
            if (before.loading && !archive.loading && !archive.problem) void read();
        });
        const stop = useBoardStore.subscribe((state, before) => {
            if (state.data === before.data && !pending.size) return;

            const current = new Set(state.data.items.map((item) => item.id));

            for (const item of before.data.items) {
                if (!current.has(item.id) && ['Shaping', 'Needs you'].includes(item.status)) pending.add(item.id);
            }
            // A restored item no longer needs an announcement from an earlier close.
            for (const id of current) pending.delete(id);
            void read();
        });

        return () => {
            state.stopped = true;
            stop();
            stopArchive();
        };
    }, []);
}
