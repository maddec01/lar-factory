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
                        ? 'Queue an item from List, or add a new one, to start shaping it.'
                        : 'Add an item to start shaping it.'
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
                                Open List
                            </Button>
                        )}
                    </>
                }
            />
        </EmptyBoard>
    );
}
