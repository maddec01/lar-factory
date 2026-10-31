import type { ItemCommentsPage } from '@lar-factory/shared';
import type { Refused } from '../config/editable-repository.ts';

/** Skip empty discussion pages with at most two larger reads. Keep a cursor when history remains unknown. */
export async function skipEmptyCommentPages(page: ItemCommentsPage, readOlder: (before: string) => Promise<ItemCommentsPage | Refused>): Promise<ItemCommentsPage | Refused> {
  for (let reads = 0; reads < 2 && page.comments.length === 0 && page.olderCursor !== null; reads++) {
    const next = await readOlder(page.olderCursor);
    if ('error' in next) return next;
    page = next;
  }
  return page;
}
