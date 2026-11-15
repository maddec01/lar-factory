// An archived row's actions in Settings › Archive: Restore for set-aside work, then a More menu with Export markdown and,
// while its ticket is open, Close ticket. Restore reads Archive again.

import type { Item } from '@lar-factory/shared';
import { Button, DropdownMenu } from '@lar-works/design-system';
import { ArchiveRestore, Ellipsis } from '@lar-works/design-system/icons';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { ExportedLine, exportMarkdown, type Exported } from '@/features/item-dialog';
import { useAbandonStore } from '@/features/items';
import { useArchiveStore } from '@/services/archive/archive.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { ActionStack, buttonKind } from '@/ui/board';

/** Restore for set-aside work, quiet, at the row's end, then a More menu with Export markdown and, while the
 *  board sees its ticket open, Close ticket. */
export function ArchiveActions({ item }: { item: Item }) {
    const [exported, setExported] = useState<Exported>({ state: 'idle' });
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const closeable = item.archived?.setAside && item.archived.ticketOpen && item.number > 0 && !item.abandonRefusal;
    const restore = async () => {
        setRestoring(true);
        setError(null);

        const result = await postAction('/api/restore', { itemId: item.id });

        // A restored item leaves Archive with this row, once Archive is read again.
        if (!result.error) await useArchiveStore.getState().load();

        flushSync(() => {
            receive(result);
            setRestoring(false);
            setError(result.error);
        });
    };

    return (
        <ActionStack below={<ExportedLine exported={exported} />} error={error}>
            {item.archived?.setAside && (
                // An App control, quiet beside the title, as every row in its section has one.
                <Button
                    {...buttonKind('control', { size: 'md' })}
                    leftIcon={<ArchiveRestore />}
                    data-restore={item.id}
                    loading={restoring}
                    onClick={() => void restore()}
                >
                    Restore
                </Button>
            )}
            <DropdownMenu modal={false}>
                <DropdownMenu.Trigger asChild>
                    <Button
                        {...buttonKind('control', { size: 'md' })}
                        iconOnly
                        leftIcon={<Ellipsis />}
                        busy={exported.state === 'exporting'}
                        aria-label={`More for ${item.title || item.id}`}
                        title="More"
                        data-archive-more={item.id}
                    />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                    <DropdownMenu.Item onSelect={() => void exportMarkdown(item.id, setExported)}>
                        Export markdown
                    </DropdownMenu.Item>
                    {closeable && (
                        <DropdownMenu.Item
                            data-archive-close={item.id}
                            onSelect={() => useAbandonStore.getState().askClose(item)}
                        >
                            Close ticket
                        </DropdownMenu.Item>
                    )}
                </DropdownMenu.Content>
            </DropdownMenu>
        </ActionStack>
    );
}
