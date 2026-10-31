import { expect, test } from 'vite-plus/test';
import type { BoardData, PublicationBoardState } from '@lar-factory/shared';
import { $, $$, fetchMock, mountPage, sample, settle, stream, text } from '../../test/support.ts';

test('finished refinement offers Publish beside Start build and retains it in the item dialog after Status changes', async () => {
  const item = { ...sample.items.find((item) => item.status === 'Ready')!, blockers: [], publication: { eligible: true, reasons: [] } };
  const data: BoardData = { ...sample, items: [item], capture: { ...sample.capture!, enabled: true, session: 'session' } };
  await mountPage(data);
  expect($(`[data-publish="${item.id}"]`)).not.toBeNull();
  expect($$('[data-start]').length).toBeGreaterThan(0);
  const before = fetchMock.mock.calls.length;
  const publication: PublicationBoardState = { readiness: { eligible: false, reasons: ['Recheck the current gate.'], sources: [] }, sources: [], settings: [], firstUse: false, pending: null };
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(publication)));
  await settle(() => $<HTMLButtonElement>(`[data-publish="${item.id}"]`)!.click());
  expect(text($('[data-publication-dialog]'))).toContain('Recheck the current gate.');
  expect(fetchMock.mock.calls.slice(before).map(([url]) => url)).toEqual(['/api/publication/open']);
  const { usePublicationStore } = await import('./publication-store.ts');
  await settle(() => usePublicationStore.getState().close());
  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify({ ...data, items: [{ ...item, status: 'In progress', statuses: ['In progress'] }] }) })));
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(item.id));
  expect($(`[data-item-dialog] [data-publish="${item.id}"]`)).not.toBeNull();
});
