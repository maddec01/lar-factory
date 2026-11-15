// Export markdown: writes an item's work record to Downloads as `lar-work export` does, then names the files it wrote,
// or says why it couldn't.

import type { Exported } from './RecordText';
import { postAction } from '@/services/board/board.service';

/** Writes the item's record as markdown files, saying how it went through `setExported`. */
export async function exportMarkdown(itemId: string, setExported: (e: Exported) => void): Promise<void> {
    setExported({ state: 'exporting' });

    const result = await postAction<{ paths: string[] }>('/api/item-export', { itemId });

    setExported(
        result.error || !result.paths
            ? { state: 'failed', error: result.error ?? 'The board didn’t say what it wrote.' }
            : { state: 'done', paths: result.paths },
    );
}
