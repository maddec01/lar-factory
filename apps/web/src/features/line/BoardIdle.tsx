// The board with no work at any stage: one message saying so and what starts work, in place of empty lanes and their
// controls. With items waiting in List it offers List too.

import { Button, EmptyState } from '@lar-works/design-system';

import { useAddItemStore } from '@/features/add-item';
import { useListStore } from '@/features/list';
import { useBoardStore } from '@/services/board/board.hooks';
import { buttonKind, EmptyBoard } from '@/ui/board';

export function BoardIdle() {
    const listed = useBoardStore((state) => state.data.items.some((item) => item.status === 'List'));

    return (
        <EmptyBoard data-board-idle>
            <EmptyState
                size="page"
                level="h2"
                title="Nothing in progress"
                description={
                    listed
                        ? 'Queue an item from the List, or add one to the List and queue it for shaping.'
                        : 'Add work to the List, then queue it for shaping.'
                }
                actions={
                    <>
                        <Button
                            {...buttonKind('main', { size: 'md' })}
                            onClick={() => useAddItemStore.getState().setOpen(true)}
                        >
                            Add item
                        </Button>
                        {listed && (
                            <Button
                                {...buttonKind('other', { size: 'md' })}
                                onClick={() => useListStore.getState().setOpen(true)}
                            >
                                Open the List
                            </Button>
                        )}
                    </>
                }
            />
        </EmptyBoard>
    );
}
